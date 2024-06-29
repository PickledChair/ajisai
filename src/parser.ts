import { Token, TokenType } from "./token.ts";
import { Lexer } from "./lexer.ts";
import {
  AstCallNode,
  AstDeclareNode,
  AstDefNode,
  AstExprNode,
  AstExprSeqNode,
  AstIfNode,
  AstLetNode,
  AstModuleNode,
  AstFuncArgNode,
  AstFuncNode,
  BinOpKind,
  AstGlobalVarNode,
  AstPathNode,
  AstModuleDeclareNode,
  AstImportNode,
} from "./ast.ts";
import { Type, isPrimitiveTypeName } from "./type.ts";

export class Parser {
  #lexer: Lexer;
  #filename: string;
  #isTopLevel: boolean = true;

  constructor(lexer: Lexer, filename: string) {
    this.#lexer = lexer;
    this.#filename = filename;
  }

  parse(): AstModuleDeclareNode {
    const filename = this.#filename.split("/").at(-1);
    if (filename == null) throw new Error(`invalid filename: ${filename}`);
    return {
      nodeType: "moduleDeclare",
      name: filename.slice(0, filename.indexOf(".")),
      mod: this.parseModule(false),
    };
  }

  private parseModule(isSubMod: boolean): AstModuleNode {
    const items = [];
    while (!this.eat("eof")) {
      if (this.eat("val")) {
        items.push(this.parseValDef());
      } else if (this.eat("func")) {
        items.push(this.parseFuncDef());
      } else if (this.eat("module")) {
        const name = this.expect("identifier").value;
        this.expect("{");
        const mod = this.parseModule(true);
        const def: AstDefNode = {
          nodeType: "def",
          declare: { nodeType: "moduleDeclare", name, mod }
        };
        items.push(def);
      } else if (this.eat("}")) {
        if (isSubMod) {
          break;
        } else {
          throw new Error("invalid token '}'");
        }
      } else if (this.eat("import")) {
        items.push(this.parseImport());
      } else {
        throw new Error("invalid definition");
      }
    }

    return { nodeType: "module", items };
  }

  private parseImport(): AstImportNode {
    const fst = this.expect("identifier");
    let path: AstGlobalVarNode | AstPathNode = { nodeType: "globalVar", name: fst.value };
    if (this.eat("::")) {
      path = this.parsePath(path.name);
    }

    let asName: AstGlobalVarNode | undefined = undefined;
    const modName = (() => {
      let p = path;
      while (p.nodeType === "path") p = p.sub;
      return p.name;
    })();
    if (modName === "super" || modName === "package") {
      asName = { nodeType: "globalVar", name: modName };
    }
    if (this.eat("as")) {
      const asNameToken = this.expect("identifier");
      asName = { nodeType: "globalVar", name: asNameToken.value };
    }

    this.expect(";");
    return { nodeType: "import", path, asName };
  }

  private parsePath(firstName: string): AstPathNode {
    const token = this.expect("identifier");
    const sub: AstGlobalVarNode = { nodeType: "globalVar", name: token.value };
    const expr: AstPathNode = { nodeType: "path", sup: firstName, sub };
    let cur = expr;
    while (this.eat("::")) {
      const token = this.expect("identifier");
      const sub: AstGlobalVarNode = { nodeType: "globalVar", name: token.value };
      if (cur.sub.nodeType === "globalVar") {
        const cur_sub: AstPathNode = { nodeType: "path", sup: cur.sub.name, sub }
        cur.sub = cur_sub;
        cur = cur_sub;
      } else {
        throw new Error("unreachable");
      }
    }
    return expr;
  }

  private parseValDef(): AstDefNode {
    const declare = this.parseValDeclare();
    this.expect(";");
    return { nodeType: "def", declare }
  }

  private parseFuncDef(): AstDefNode {
    const declare = this.parseFuncDeclare();
    return { nodeType: "def", declare };
  }

  private parseType(): Type {
    if (this.eat("(")) {
      // TODO: 現在はunit型だけ考慮すれば良いが、いずれタプルに対応する
      this.expect(")");
      return { tyKind: "primitive", name: "()" };
    } else {
      if (this.eat("func")) {
        this.expect("(");

        const argTypes: Type[] = [];
        while (!this.eat(")")) {
          argTypes.push(this.parseType());
          if (!this.eat(",")) {
            this.expect(")");
            break;
          }
        }

        let bodyType: Type = { tyKind: "primitive", name: "()" };
        if (this.eat("->")) {
          bodyType = this.parseType();
        }

        return { tyKind: "func", funcKind: this.#isTopLevel ? "userdef" : "closure", argTypes, bodyType };
      }

      const tyName = this.expect("identifier").value;
      const builtinName = isPrimitiveTypeName(tyName);
      if (builtinName) {
        return { tyKind: "primitive", name: builtinName };
      } else {
        // TODO: collection type やユーザー定義型に対応
        throw new Error("unimplemented for collection type and user definition type signature");
      }
    }
  }

  private parseFuncArg(): AstFuncArgNode {
    const name = this.expect("identifier");
    // TODO: モジュールレベルの関数定義では引数の型注釈が必須だが、
    //       型推論実装後はローカルでの関数定義では引数の型注釈を
    //       省略できるようにする
    this.expect(":");
    const ty = this.parseType();
    return { nodeType: "funcArg", name: name.value, ty };
  }

  parseExpr(): AstExprNode {
    return this.parseLogOr();
  }

  private parseExprSeq(): AstExprSeqNode {
    const exprs: AstExprNode[] = [];

    while (true) {
      exprs.push(this.parseExpr());

      if (this.eat(";")) {
        if (this.eat("}")) {
          exprs.push({ nodeType: "unit" });
          break;
        } else {
          continue;
        }
      } else {
        this.expect("}");
        break;
      }
    }

    return { nodeType: "exprSeq", exprs };
  }

  private parseLet(): AstLetNode {
    const oldLevel = this.#isTopLevel;
    this.#isTopLevel = false;

    const declares = [];
    if (!this.eat("{")) {
      while (true) {
        if (this.eat("val")) {
          declares.push(this.parseValDeclare());
          this.eat(",");
          continue;
        }
        if (this.eat("func")) {
          declares.push(this.parseFuncDeclare());
          this.eat(",");
          continue;
        }
        break;
      }
      this.expect("{");
    }
    const body = this.parseExprSeq();

    this.#isTopLevel = oldLevel;

    return { nodeType: "let", declares, body, envId: -1 };
  }

  private parseValDeclare(): AstDeclareNode {
    const variable = this.eat("identifier");
    if (variable) {
      let ty: Type | undefined = undefined;
      if (this.eat(":")) {
        ty = this.parseType();
      }
      this.expect("=");
      const body = this.parseExpr();
      return {
        nodeType: "declare",
        name: variable.value,
        ty,
        value: body
      };
    }
    throw new Error("Could not parse declaration");
  }

  private parseFuncDeclare(): AstDeclareNode {
    const name = this.expect("identifier");
    const funcNode = this.parseFunc();
    const argTypes = funcNode.args.map(arg => arg.ty!);
    const bodyType = funcNode.bodyTy;
    return {
      nodeType: "declare",
      name: name.value,
      value: funcNode,
      ty: { tyKind: "func", funcKind: this.#isTopLevel ? "userdef" : "closure", argTypes, bodyType }
    };
  }

  private parseFunc(): AstFuncNode {
    const oldLevel = this.#isTopLevel;
    this.#isTopLevel = false;

    this.expect("(");
    const args = [];

    if (!this.eat(")")) {
      while (true) {
        args.push(this.parseFuncArg());
        if (!this.eat(",")) break;
      }
      this.expect(")");
    }

    let bodyTy: Type = { tyKind: "primitive", name: "()" };
    if (this.eat("->")) {
      bodyTy = this.parseType();
    }

    this.expect("{");
    const body = this.parseExprSeq();

    this.#isTopLevel = oldLevel;

    return { nodeType: "func", args, body, envId: -1, bodyTy };
  }

  private parseIf(): AstIfNode {
    const cond = this.parseExpr();

    this.expect("{");
    const then = this.parseExprSeq();

    this.expect("else");

    if (this.eat("{")) {
      const else_ = this.parseExprSeq();
      return { nodeType: "if", cond, then, else: else_ };
    }

    if (this.eat("if")) {
      const nextIf = this.parseIf();
      return {
        nodeType: "if", cond, then,
        else: { nodeType: "exprSeq", exprs: [nextIf] }
      };
    }

    throw new Error("Could not parse if expression");
  }

  private parseGroup(): AstExprNode {
    const expr = this.parseExpr();
    this.expect(")");
    return expr;
  }

  private parseLogOr(): AstExprNode {
    let left = this.parseLogAnd();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "||":
          operator = "||";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseLogAnd();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseLogAnd(): AstExprNode {
    let left = this.parseEquality();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "&&":
          operator = "&&";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseEquality();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseEquality(): AstExprNode {
    let left = this.parseRelational();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "==":
          operator = "==";
          break;
        case "!=":
          operator = "!=";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseRelational();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseRelational(): AstExprNode {
    let left = this.parseTerm();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "<":
          operator = "<";
          break;
        case "<=":
          operator = "<=";
          break;
        case ">":
          operator = ">";
          break;
        case ">=":
          operator = ">=";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseTerm();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseTerm(): AstExprNode {
    let left = this.parseFactor();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "+":
          operator = "+";
          break;
        case "-":
          operator = "-";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseFactor();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseFactor(): AstExprNode {
    let left = this.parseUnary();

    while (true) {
      let operator: BinOpKind;
      switch (this.#lexer.peekToken().tokenType) {
        case "*":
          operator = "*";
          break;
        case "/":
          operator = "/";
          break;
        case "%":
          operator = "%";
          break;
        default:
          return left;
      }
      this.#lexer.nextToken();

      const right = this.parseUnary();
      left = { nodeType: "binary", operator, left, right };
    }
  }

  private parseUnary(): AstExprNode {
    if (this.eat("-")) {
      const operand = this.parsePrimary();
      return { nodeType: "unary", operator: "-", operand };
    } else if (this.eat("!")) {
      const operand = this.parsePrimary();
      return { nodeType: "unary", operator: "!", operand };
    } else {
      return this.parsePrimary();
    }
  }

  private parsePrimary(): AstExprNode {
    let token;
    let expr: AstExprNode | undefined = undefined;

    token = this.eat("true") ?? this.eat("false");
    if (token) {
      expr = { nodeType: "bool", value: token.value == "true" };
    }

    if (expr == null) {
      token = this.eat("string");
      if (token) {
        expr = { nodeType: "string", value: token.value, len: 0 };
      }
    }

    if (expr == null) {
      token = this.eat("integer");
      if (token) {
        expr = { nodeType: "integer", value: parseInt(token.value) };
      }
    }

    if (expr == null && this.eat("(")) {
      if (this.eat(")")) {
        return { nodeType: "unit" };
      }
      expr = this.parseGroup();
    }

    if (expr == null) {
      token = this.eat("identifier");
      if (token) {
        expr = { nodeType: "localVar", name: token.value, fromEnv: -1, toEnv: -1 };
        if (this.eat("::")) {
          expr = this.parsePath(expr.name);
        }
      }
    }

    if (expr == null && this.eat("let")) {
      expr = this.parseLet();
    }

    if (expr == null && this.eat("if")) {
      expr = this.parseIf();
    }

    if (expr == null && this.eat("func")) {
      expr = this.parseFunc();
    }

    if (expr) return this.parsePostfix(expr);

    throw new Error("Invalid primary token");
  }

  private parsePostfix(pre: AstExprNode): AstExprNode {
    let expr = pre;
    while (true) {
      if (this.eat("(")) {
        expr = this.parseCall(expr);
        continue;
      }

      return expr;
    }
  }

  private parseCall(callee: AstExprNode): AstCallNode {
    const args: AstExprNode[] = [];

    if (this.eat(")")) return { nodeType: "call", callee, args };

    while (true) {
      args.push(this.parseExpr());
      if (!this.eat(",")) {
        break;
      }
    }
    this.expect(")");
    return { nodeType: "call", callee, args };
  }

  private eat(tokenType: TokenType): Token | null {
    const token = this.#lexer.peekToken();
    if (token.tokenType == tokenType) {
      this.#lexer.nextToken();
      return token;
    } else {
      return null;
    }
  }

  private expect(tokenType: TokenType): Token {
    const token = this.eat(tokenType);
    if (token) {
      return token;
    } else {
      throw new Error(`Expected token type: ${tokenType}, but not given`);
    }
  }
}
