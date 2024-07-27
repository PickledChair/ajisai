import { Type } from "./type.ts";

export type AstNodeType = AstNode["nodeType"];

export type AstNode =
  AstModuleNode
  | AstModuleItemNode
  | AstFuncArgNode
  | AstDeclareNode
  | AstExprNode;

export type AstModuleNode = { nodeType: "module", items: AstModuleItemNode[], envId: number, rootTableSize?: number };
export type AstModuleItemNode = AstDefNode | AstImportNode | AstExprStmtNode;

export type AstDefNode = { nodeType: "def", declare: AstDeclareNode | AstModuleDeclareNode };

export type AstImportNode = {
  nodeType: "import",
  path: AstPathNode | AstGlobalVarNode,
  asName?: AstGlobalVarNode
};

export type AstModuleDeclareNode = { nodeType: "moduleDeclare", name: string, mod: AstModuleNode };

export type AstExprStmtNode = { nodeType: "exprStmt", expr: AstExprNode };

export type AstExprNode =
  AstExprSeqNode
  | AstFuncNode
  | AstIfNode
  | AstLetNode
  | AstCallNode
  | AstBinaryNode
  | AstUnaryNode
  | AstBoolNode
  | AstIntegerNode
  | AstStringLitNode
  | AstVariableNode
  | AstPathNode
  | AstUnitNode;

export type AstExprSeqNode = { nodeType: "exprSeq", exprs: AstExprNode[], ty?: Type };

// NOTE: bodyTy はコードで指定なしの時にユニット型になることに注意する
export type AstFuncNode = { nodeType: "func", args: AstFuncArgNode[], body: AstExprSeqNode, envId: number, bodyTy: Type, rootTableSize?: number, closureId?: number, ty?: Type, rootIdx?: number };
export type AstFuncArgNode = { nodeType: "funcArg", name: string, ty?: Type };

export type AstLetNode = { nodeType: "let", declares: AstDeclareNode[], body: AstExprSeqNode, bodyTy?: Type, envId: number, rootIdx?: number, rootIndices?: number[] };

export type AstDeclareNode = { nodeType: "declare", name: string, ty?: Type, value: AstExprNode, modName?: string };

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

export type AstVariableNode = AstLocalVarNode | AstGlobalVarNode;
export type AstLocalVarNode = { nodeType: "localVar", name: string, fromEnv: number, toEnv: number, ty?: Type };
export type AstGlobalVarNode = { nodeType: "globalVar", name: string, modName?: string, ty?: Type };

export type AstPathNode = { nodeType: "path", sup: string, sub: AstPathNode | AstGlobalVarNode };
