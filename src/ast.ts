import { Type } from "./type.ts";

export type AstNodeType =
  "module"
  | "def" | "proc" | "procArg" | "declare" | "if" | "let"
  | "binary" | "unary" | "call" | "bool" | "integer" | "variable" | "unit";

export type AstNode = AstModuleNode | AstDefNode | AstProcArgNode | AstDeclareNode | AstExprNode;

export type AstModuleNode = { nodeType: "module", defs: AstDefNode[] };

export type AstDefNode = { nodeType: "def", declare: AstDeclareNode };

export type AstExprNode =
  AstProcNode | AstIfNode | AstLetNode | AstCallNode | AstBinaryNode | AstUnaryNode | AstBoolNode | AstIntegerNode | AstVariableNode | AstUnitNode;

export type AstProcNode = { nodeType: "proc", args: AstProcArgNode[], body: AstExprNode, envId: number, bodyTy?: Type };
export type AstProcArgNode = { nodeType: "procArg", name: string, ty?: Type };

export type AstLetNode = { nodeType: "let", declares: AstDeclareNode[], body: AstExprNode, bodyTy?: Type, envId: number };

export type AstDeclareNode = { nodeType: "declare", name: string, ty?: Type, value: AstExprNode };

export type AstIfNode = { nodeType: "if", cond: AstExprNode, then: AstExprNode, else: AstExprNode, ty?: Type };

export type BinOpKind = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
export type AstBinaryNode = { nodeType: "binary", operator: BinOpKind, left: AstExprNode, right: AstExprNode, ty?: Type };

export type UnOpKind = "-" | "!";
export type AstUnaryNode = { nodeType: "unary", operator: UnOpKind, operand: AstExprNode, ty?: Type };

export type AstCallNode = { nodeType: "call", callee: AstExprNode, args: AstExprNode[], ty?: Type };

export type AstUnitNode = { nodeType: "unit" };
export type AstIntegerNode = { nodeType: "integer", value: number };
export type AstBoolNode = { nodeType: "bool", value: boolean };
export type AstVariableNode = { nodeType: "variable", name: string, level: number, fromEnv: number, toEnv: number, ty?: Type };
