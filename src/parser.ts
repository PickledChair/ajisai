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
  BinOpKind
} from "./ast.ts";
import { Type, isPrimitiveTypeName } from "./type.ts";

export class Parser {
  #lexer: Lexer;
  #isTopLevel: boolean = true;

  constructor(lexer: Lexer) {
    this.#lexer = lexer;
  }

  parse(): AstModuleNode {
    const defs = [];
    while (!this.eat("eof")) {
      if (this.eat("val")) {
        defs.push(this.parseValDef());
      } else if (this.eat("func")) {
        defs.push(this.parseFuncDef());
      } else {
        throw new Error("invalid definition");
      }
    }

    return { nodeType: "module", defs };
  }

  private parseValDef(): AstDefNode {
    const declare = this.parseDeclare();
    this.expect(";");
    return { nodeType: "def", declare }
  }

  private parseFuncDef(): AstDefNode {
    const name = this.expect("identifier");
    const funcNode = this.parseFunc();
    const argTypes = funcNode.args.map(arg => arg.ty!);
    const bodyType = funcNode.bodyTy;
    const declare: AstDeclareNode = {
      nodeType: "declare",
      name: name.value,
      value: funcNode,
      ty: { tyKind: "func", funcKind: this.#isTopLevel ? "userdef" : "closure", argTypes, bodyType }
    };
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
    const declares = [];
    if (!this.eat("{")) {
      while (true) {
        declares.push(this.parseDeclare());
        if (!this.eat(",")) break;
      }
      this.expect("{");
    }
    const body = this.parseExprSeq();

    return { nodeType: "let", declares, body, envId: -1 };
  }

  private parseDeclare(): AstDeclareNode {
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
      const operand = this.parseExpr();
      return { nodeType: "unary", operator: "-", operand };
    } else if (this.eat("!")) {
      const operand = this.parseExpr();
      return { nodeType: "unary", operator: "!", operand };
    } else {
      return this.parsePrimary();
    }
  }

  private parsePrimary(): AstExprNode {
    let token;

    token = this.eat("true") ?? this.eat("false");
    if (token) {
      return { nodeType: "bool", value: token.value == "true" };
    }

    token = this.eat("string");
    if (token) {
      return { nodeType: "string", value: token.value, len: 0 };
    }

    token = this.eat("integer");
    if (token) {
      return { nodeType: "integer", value: parseInt(token.value) };
    }

    let expr: AstExprNode | undefined;

    token = this.eat("(");
    if (token) {
      if (this.eat(")")) {
        return { nodeType: "unit" };
      }
      expr = this.parseGroup();
    }

    token = this.eat("identifier");
    if (token) {
      expr = { nodeType: "variable", name: token.value, level: -1, fromEnv: -1, toEnv: -1 };
    }

    token = this.eat("let");
    if (token) {
      expr = this.parseLet();
    }

    token = this.eat("if");
    if (token) {
      expr = this.parseIf();
    }

    token = this.eat("func");
    if (token) {
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
