import { Token, TokenType } from "./token.ts";
import { Lexer } from "./lexer.ts";
import { AstCallNode, AstDeclareNode, AstDefNode, AstExprNode, AstExprSeqNode, AstIfNode, AstLetNode, AstModuleNode, AstProcArgNode, BinOpKind } from "./ast.ts";
import { Type, isPrimitiveTypeName } from "./type.ts";

export class Parser {
  #lexer: Lexer;

  constructor(lexer: Lexer) {
    this.#lexer = lexer;
  }

  parse(): AstModuleNode {
    const defs = [];
    while (!this.eat("eof")) {
      if (this.eat("proc")) {
        defs.push(this.parseProcDef());
      } else {
        throw new Error("invalid definition");
      }
    }

    return { nodeType: "module", defs };
  }

  private parseProcDef(): AstDefNode {
    const name = this.expect("identifier");
    this.expect("(");
    const args = [];
    if (!this.eat(")")) {
      while (true) {
        args.push(this.parseProcArg());
        if (!this.eat(",")) break;
      }
      this.expect(")");
    }
    const argTypes = args.map(arg => arg.ty!);

    let bodyType: Type;
    if (this.eat("->")) {
      const tyName = isPrimitiveTypeName(this.expect("identifier").value);
      if (tyName) {
        bodyType = { tyKind: "primitive", name: tyName };
      } else {
        throw new Error("unimplemented for custom type");
      }
    } else {
      bodyType = { tyKind: "primitive", name: "()" };
    }

    this.expect("{");
    const body = this.parseExprSeq();

    const declare: AstDeclareNode = {
      nodeType: "declare",
      name: name.value,
      value: { nodeType: "proc", args, body, envId: -1 },
      ty: { tyKind: "proc", procKind: "userdef", argTypes, bodyType }
    };
    return { nodeType: "def", declare };
  }

  private parseProcArg(): AstProcArgNode {
    const name = this.expect("identifier");
    this.expect(":");
    let ty: Type;
    if (this.eat("(")) {
      // TODO: 現在はunit型だけ考慮すれば良いが、いずれタプルに対応する
      this.expect(")");
      ty = { tyKind: "primitive", name: "()" };
    } else {
      const tyName = this.expect("identifier").value;
      const builtinName = isPrimitiveTypeName(tyName);
      if (builtinName) {
        ty = { tyKind: "primitive", name: builtinName };
      } else {
        // TODO: collection type やユーザー定義型に対応
        throw new Error("unimplemented for collection type and user definition type signature");
      }
    }
    return { nodeType: "procArg", name: name.value, ty };
  }

  parseExpr(): AstExprNode {
    if (this.eat("let")) {
      return this.parseLet();
    }
    if (this.eat("if")) {
      return this.parseIf();
    }
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
      this.expect("=");
      const body = this.parseExpr();
      return {
        nodeType: "declare",
        name: variable.value,
        value: body
      };
    }
    throw new Error("Could not parse declaration");
  }

  private parseIf(): AstIfNode {
    const cond = this.parseExpr();

    this.expect("{");
    const then = this.parseExprSeq();

    this.expect("else");

    this.expect("{");
    const else_ = this.parseExprSeq();

    return { nodeType: "if", cond, then, else: else_ };
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
      return { nodeType: "string", value: token.value };
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

    if (expr) return this.parsePostfix(expr);

    throw new Error("Invalid primary token");
  }

  private parsePostfix(pre: AstExprNode): AstExprNode {
    let expr = pre;
    if (this.eat("(")) {
      expr = this.parseCall(pre);
    }
    return expr;
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
