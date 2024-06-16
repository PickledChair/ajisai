import { Type } from "./type.ts";

export type AstNodeType =
  "module"
  | "def" | "func" | "funcArg" | "declare" | "if" | "let"
  | "binary" | "unary" | "call" | "bool" | "integer" | "string" | "variable" | "unit";

export type AstNode = AstModuleNode | AstDefNode | AstFuncArgNode | AstDeclareNode | AstExprNode;

export type AstModuleNode = { nodeType: "module", defs: AstDefNode[] };

export type AstDefNode = { nodeType: "def", declare: AstDeclareNode };

export type AstExprNode = AstExprSeqNode |
  AstFuncNode | AstIfNode | AstLetNode | AstCallNode | AstBinaryNode | AstUnaryNode | AstBoolNode | AstIntegerNode | AstStringLitNode | AstVariableNode | AstUnitNode;

export type AstExprSeqNode = { nodeType: "exprSeq", exprs: AstExprNode[], ty?: Type };

// NOTE: bodyTy はコードで指定なしの時にユニット型になることに注意する
export type AstFuncNode = { nodeType: "func", args: AstFuncArgNode[], body: AstExprSeqNode, envId: number, bodyTy: Type, rootTableSize?: number, closureId?: number, ty?: Type, rootIdx?: number };
export type AstFuncArgNode = { nodeType: "funcArg", name: string, ty?: Type };

export type AstLetNode = { nodeType: "let", declares: AstDeclareNode[], body: AstExprSeqNode, bodyTy?: Type, envId: number, rootIdx?: number, rootIndices?: number[] };

export type AstDeclareNode = { nodeType: "declare", name: string, ty?: Type, value: AstExprNode };

export type AstIfNode = { nodeType: "if", cond: AstExprNode, then: AstExprSeqNode, else: AstExprSeqNode, ty?: Type };

export type BinOpKind = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
export type AstBinaryNode = { nodeType: "binary", operator: BinOpKind, left: AstExprNode, right: AstExprNode, ty?: Type };

export type UnOpKind = "-" | "!";
export type AstUnaryNode = { nodeType: "unary", operator: UnOpKind, operand: AstExprNode, ty?: Type };

export type AstCallNode = { nodeType: "call", callee: AstExprNode, args: AstExprNode[], ty?: Type, calleeTy?: Type, rootIdx?: number };

export type AstUnitNode = { nodeType: "unit" };
export type AstIntegerNode = { nodeType: "integer", value: number };
export type AstStringLitNode = { nodeType: "string", value: string, len: number };
export type AstBoolNode = { nodeType: "bool", value: boolean };
export type AstVariableNode = { nodeType: "variable", name: string, level: number, fromEnv: number, toEnv: number, ty?: Type };
