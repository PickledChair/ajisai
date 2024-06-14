import {
  ACClosureMakeInst,
  ACEntryInst,
  ACModuleInst,
  ACFuncBodyInst,
  ACDeclInst,
  ACDefInst,
  ACFuncFrameDefTmpNoValInst,
  ACPushValInst
} from "./acir.ts";

import {
  AstBinaryNode,
  AstCallNode,
  AstExprNode,
  AstExprSeqNode,
  AstIfNode,
  AstLetNode,
  AstModuleNode,
  AstFuncNode,
  AstUnaryNode,
  AstVariableNode
} from "./ast.ts";

import { DefTypeMap } from "./semant.ts";
import {
  PrimitiveType,
  FuncType,
  Type,
  mayBeHeapObj,
  tyEqual
} from "./type.ts";

export class CodeGenerator {
  #module: AstModuleNode;
  #defTypeMap: DefTypeMap;

  constructor(module: AstModuleNode, defTypeMap: DefTypeMap) {
    this.#module = module;
    this.#defTypeMap = defTypeMap;
  }

  codegen(): ACModuleInst {
    const funcDecls = [];
    const funcDefs = [];
    let entry = undefined;

    for (const def of this.#module.defs) {
      if (def.declare.ty!.tyKind === "func") {
        const funcCodeGen = new FuncCodeGenerator(def.declare.name, def.declare.ty!, def.declare.value as AstFuncNode);
        const [funcDecl, funcDef] = funcCodeGen.codegen(this.#defTypeMap);
        if (funcDecl) funcDecls.push(funcDecl);
        if (funcDef.inst === "func.def" || funcDef.inst === "closure.def") {
          funcDefs.push(funcDef);
        } else if (funcDef.inst === "entry") {
          entry = funcDef;
        }
      }
    }

    return { inst: "module", funcDecls, funcDefs, entry };
  }
}

type EnvContext = { envId: number, isFuncEnv: boolean };

class FuncContext {
  funcName: string;
  #envStack: EnvContext[];
  #freshTmpId = 0;

  constructor(funcName: string, envId: number) {
    this.funcName = funcName;
    this.#envStack = [];
    this.#envStack.push({ envId, isFuncEnv: true });
  }

  enterScope(envId: number) {
    this.#envStack.push({ envId, isFuncEnv: false });
  }

  leaveScope() {
    this.#envStack.pop();
  }

  get currentEnvId(): number {
    return this.#envStack.at(-1)!.envId;
  }

  get freshFuncTmpId(): number {
    return this.#freshTmpId++;
  }

  currentEnvIsFunc(): boolean {
    return this.#envStack.at(-1)!.isFuncEnv;
  }

  get funcEnvId(): number {
    return this.#envStack.at(0)!.envId;
  }
}

const getExprType = (expr: AstExprNode): Type | undefined => {
  switch (expr.nodeType) {
    case "func": return expr.ty;
    case "if": return expr.ty;
    case "let": return expr.bodyTy;
    case "exprSeq": return expr.ty;
    case "call": return expr.ty;
    case "binary": return expr.ty;
    case "unary": return expr.ty;
    case "bool": return { tyKind: "primitive", name: "bool" };
    case "integer": return { tyKind: "primitive", name: "i32" };
    case "string": return { tyKind: "primitive", name: "str" };
    case "variable": return expr.ty;
    case "unit": return { tyKind: "primitive", name: "()" };
  }
};

class FuncCodeGenerator {
  #funcTy: FuncType;
  #funcNode: AstFuncNode;
  #funcCtx: FuncContext;

  constructor(funcName: string, funcTy: FuncType, func: AstFuncNode) {
    this.#funcTy = funcTy;
    this.#funcNode = func;
    this.#funcCtx = new FuncContext(funcName, func.envId);
  }

  codegen(defTypeMap: DefTypeMap): [ACDeclInst | undefined, ACDefInst | ACEntryInst] {
    const funcDeclInst = this.makeFuncDeclInst();

    let bodyInsts: ACFuncBodyInst[]  = [];
    if (this.#funcNode.rootTableSize! > 0) {
      bodyInsts.push({ inst: "root_table.init", size: this.#funcNode.rootTableSize! });
    }
    bodyInsts.push({ inst: "func_frame.init", rootTableSize: this.#funcNode.rootTableSize! });

    const { prelude, valInst } = this.codegenExprSeq(this.#funcNode.body, defTypeMap);

    if (prelude) {
      bodyInsts = bodyInsts.concat(prelude);
    }

    if (valInst) {
      if (tyEqual(funcDeclInst.resultType, { tyKind: "primitive", name: "()" })) {
        bodyInsts.push(valInst);
      } else {
        bodyInsts.push({ inst: "func.return", value: valInst });
      }
    }

    if (funcDeclInst.funcName === "main") {
      return [
        undefined,
        { inst: "entry", body: bodyInsts }
      ];
    } else {
      return [
        funcDeclInst,
        {
          inst: this.#funcNode.closureId == null ? "func.def" : "closure.def",
          funcName: funcDeclInst.funcName,
          args: funcDeclInst.args,
          resultType: funcDeclInst.resultType,
          envId: this.#funcCtx.funcEnvId,
          body: bodyInsts
        }
      ];
    }
  }

  private makeFuncDeclInst(): ACDeclInst {
    return {
      inst: this.#funcNode.closureId == null ? "func.decl" : "closure.decl",
      funcName: this.#funcCtx.funcName,
      args: this.#funcNode.args.map(arg => [arg.name, arg.ty!]),
      resultType: this.#funcTy.bodyType
    };
  }

  private codegenExpr(ast: AstExprNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    switch (ast.nodeType) {
      case "func":
        return this.codegenClosure(ast);
      case "unary":
        return this.codegenUnary(ast, defTypeMap);
      case "binary":
        return this.codegenBinary(ast, defTypeMap);
      case "call":
        return this.codegenCall(ast, defTypeMap);
      case "let":
        return this.codegenLet(ast, defTypeMap);
      case "if":
        return this.codegenIf(ast, defTypeMap);
      case "integer":
        return { valInst: { inst: "i32.const", value: ast.value } };
      case "bool":
        return { valInst: { inst: "bool.const", value: ast.value } };
      case "string": {
        const strId = this.#funcCtx.freshFuncTmpId;
        return {
          prelude: [{ inst: "str.make_static", id: strId, value: ast.value, len: ast.len }],
          valInst: { inst: "str.const", id: strId }
        };
      }
      case "unit":
        return {};
      case "variable":
        return this.codegenVariable(ast, defTypeMap);
      default:
        throw new Error(`invalid expr node: ${ast.nodeType}`);
    }
  }

  private codegenUnary(ast: AstUnaryNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    const { prelude: opePrelude, valInst: opeValInst } = this.codegenExpr(ast.operand, defTypeMap);
    if (opeValInst) {
      if (ast.operator === "-") {
        return { prelude: opePrelude, valInst: { inst: "i32.neg", operand: opeValInst } };
      }
      if (ast.operator === "!") {
        return { prelude: opePrelude, valInst: { inst: "bool.not", operand: opeValInst } };
      }
    }
    throw new Error("invalid unary node");
  }

  private codegenBinary(ast: AstBinaryNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    const { prelude: leftPrelude, valInst: leftValInst } = this.codegenExpr(ast.left, defTypeMap);
    const { prelude: rightPrelude, valInst: rightValInst } = this.codegenExpr(ast.right, defTypeMap);

    let prelude: ACFuncBodyInst[] | undefined = undefined;
    if (leftPrelude || rightPrelude) {
      prelude = [];
      if (leftPrelude) prelude = prelude.concat(leftPrelude);
      if (rightPrelude) prelude = prelude.concat(rightPrelude);
    }

    if (tyEqual(ast.ty!, { tyKind: "primitive", name: "i32" })) {
      switch (ast.operator) {
        case "+": return { prelude, valInst: { inst: "i32.add", left: leftValInst!, right: rightValInst! } };
        case "-": return { prelude, valInst: { inst: "i32.sub", left: leftValInst!, right: rightValInst! } };
        case "*": return { prelude, valInst: { inst: "i32.mul", left: leftValInst!, right: rightValInst! } };
        case "/": return { prelude, valInst: { inst: "i32.div", left: leftValInst!, right: rightValInst! } };
        case "%": return { prelude, valInst: { inst: "i32.mod", left: leftValInst!, right: rightValInst! } };
      }
    }

    if (tyEqual(ast.ty!, { tyKind: "primitive", name: "bool" })) {
      const boolType: PrimitiveType = { tyKind: "primitive", name: "bool" };
      const i32Type: PrimitiveType = { tyKind: "primitive", name: "i32" };

      const leftTy = getExprType(ast.left);
      const rightTy = getExprType(ast.right);

      if (tyEqual(leftTy!, boolType) && tyEqual(rightTy!, boolType)) {
        switch (ast.operator) {
          case "==": return { prelude, valInst: { inst: "bool.eq", left: leftValInst!, right: rightValInst! } };
          case "!=": return { prelude, valInst: { inst: "bool.ne", left: leftValInst!, right: rightValInst! } };
          case "&&": return { prelude, valInst: { inst: "bool.and", left: leftValInst!, right: rightValInst! } };
          case "||": return { prelude, valInst: { inst: "bool.or", left: leftValInst!, right: rightValInst! } };
        }
      }

      if (tyEqual(leftTy!, i32Type) && tyEqual(rightTy!, i32Type)) {
        switch (ast.operator) {
          case "==": return { prelude, valInst: { inst: "i32.eq", left: leftValInst!, right: rightValInst! } };
          case "!=": return { prelude, valInst: { inst: "i32.ne", left: leftValInst!, right: rightValInst! } };
          case "<": return { prelude, valInst: { inst: "i32.lt", left: leftValInst!, right: rightValInst! } };
          case "<=": return { prelude, valInst: { inst: "i32.le", left: leftValInst!, right: rightValInst! } };
          case ">": return { prelude, valInst: { inst: "i32.gt", left: leftValInst!, right: rightValInst! } };
          case ">=": return { prelude, valInst: { inst: "i32.ge", left: leftValInst!, right: rightValInst! } };
        }
      }
    }

    throw new Error("unimplemented for other type");
  }

  private codegenCall(ast: AstCallNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    const { prelude: calleePrelude, valInst: calleeValInst } = this.codegenExpr(ast.callee, defTypeMap);

    if (calleePrelude) prelude = prelude.concat(calleePrelude);
    const args: ACPushValInst[] = [];

    for (const arg of ast.args) {
      const { prelude: argPrelude, valInst } = this.codegenExpr(arg, defTypeMap);
      if (argPrelude) prelude = prelude.concat(argPrelude);

      if (arg.nodeType === "variable" &&
          arg.ty!.tyKind === "func" &&
          arg.ty!.funcKind !== "closure") {
        const closureId = this.#funcCtx.freshFuncTmpId;

        prelude.push({
          inst: "closure.make_static", id: closureId, funcKind: arg.ty!.funcKind, name: arg.name
        });

        args.push({ inst: "closure.const", id: closureId });
      } else if (arg.nodeType !== "unit") {
        args.push(valInst!);
      }
      // unit value は引数として渡さない
    }

    const calleeIsFuncLiteral = ast.callee.nodeType === "func";
    const varTy = ast.calleeTy;

    if (varTy && varTy.tyKind === "func") {
      let valInst: ACPushValInst;

      if (calleeIsFuncLiteral || varTy.funcKind === "closure") {
        valInst = { inst: "closure.call", callee: calleeValInst!, args, argTypes: varTy.argTypes, bodyType: varTy.bodyType };
      } else {
        valInst = { inst: "func.call", callee: calleeValInst!, args };
      }

      if (mayBeHeapObj(varTy.bodyType)) {
        const tmpId = this.#funcCtx.freshFuncTmpId;

        const defTmpInst: ACFuncBodyInst = { inst: "func_frame.deftmp", envId: this.#funcCtx.funcEnvId, idx: tmpId, ty: ast.ty!, value: valInst };
        prelude.push(defTmpInst);

        const rootRegInst: ACFuncBodyInst = { inst: "root_table.reg", envId: this.#funcCtx.funcEnvId, rootTableIdx: ast.rootIdx!, tmpVarIdx: tmpId };
        prelude.push(rootRegInst);

        valInst = { inst: "func_frame.load_tmp", envId: this.#funcCtx.funcEnvId, idx: tmpId };
      }

      return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
    } else {
      throw new Error(`invalid callee type: ${varTy}`);
    }
  }

  private codegenVariable(ast: AstVariableNode, defTypeMap: DefTypeMap): { valInst: ACPushValInst } {
    if (ast.level === -1) {
      const varTy = defTypeMap.get(ast.name);
      if (varTy) {
        if (varTy.tyKind === "func") {
          if (varTy.funcKind === "userdef") {
            return { valInst: { inst: "mod_defs.load", varName: ast.name } };
          } else if (varTy.funcKind === "closure") {
            return { valInst: { inst: "closure.load", id: ast.name} };
          } else if (varTy.funcKind === "builtin") {
            return { valInst: { inst: "builtin.load", varName: ast.name } };
          }
          throw new Error("unreachable");
        } else {
          throw new Error("unimplemented for non-func def load");
        }
      } else {
        throw new Error(`variable '${ast.name}' not found`);
      }
    } else {
      return { valInst: { inst: "env.load", envId: ast.toEnv, varName: ast.name } };
    }
  }

  private codegenExprSeq(ast: AstExprSeqNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    let valInst: ACPushValInst | undefined = undefined;

    ast.exprs.forEach((expr, idx) => {
      const { prelude: exprPrelude, valInst: exprValInst } = this.codegenExpr(expr, defTypeMap);
      if (exprPrelude) prelude = prelude.concat(exprPrelude);

      if (idx === ast.exprs.length - 1) {
        valInst = exprValInst;
      } else {
        if (exprValInst) prelude.push(exprValInst);
      }
    });

    return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
  }

  private codegenLet(ast: AstLetNode, defTypeMap: DefTypeMap): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];

    this.#funcCtx.enterScope(ast.envId);

    let returnVar: ACFuncFrameDefTmpNoValInst | undefined;
    if (mayBeHeapObj(ast.bodyTy!)) {
      returnVar = { inst: "func_frame.deftmp_noval", envId: this.#funcCtx.funcEnvId, idx: this.#funcCtx.freshFuncTmpId, ty: ast.bodyTy! };
      prelude.push(returnVar);
    }

    for (const { name, value, ty } of ast.declares) {
      const { prelude: valPrelude, valInst } = this.codegenExpr(value, defTypeMap);
      if (valPrelude) prelude = prelude.concat(valPrelude);

      if (value.nodeType === "variable" && value.ty!.tyKind === "func" && value.ty!.funcKind !== "closure") {
        const closureId = this.#funcCtx.freshFuncTmpId;

        prelude.push({
          inst: "closure.make_static", id: closureId, funcKind: value.ty!.funcKind, name: value.name
        });

        prelude.push(
          { inst: "env.defvar", envId: ast.envId, varName: name, ty: ty!, value: { inst: "closure.const", id: closureId } }
        );
      } else if (!tyEqual(ty!, { tyKind: "primitive", name: "()" })) {
        prelude.push(
          { inst: "env.defvar", envId: ast.envId, varName: name, ty: ty!, value: valInst! }
        );
      }
      // unit value は変数として定義しない
    }

    const { prelude: bodyPrelude, valInst: valInst_ } = this.codegenExprSeq(ast.body, defTypeMap);
    if (bodyPrelude) prelude = prelude.concat(bodyPrelude);

    let valInst: ACPushValInst | undefined;
    if (tyEqual(ast.bodyTy!, { tyKind: "primitive", name: "()" }) && valInst_) {
      prelude.push(valInst_);
    } else {
      valInst = valInst_;
    }

    if (ast.rootIndices!.length !== 0) {
      for (const idx of ast.rootIndices!) {
        const unregInst: ACFuncBodyInst = { inst: "root_table.unreg", idx };
        prelude.push(unregInst);
      }
    }

    this.#funcCtx.leaveScope();

    if (returnVar) {
      prelude.push({
        inst: "func_frame.store_tmp", envId: returnVar.envId, idx: returnVar.idx, value: valInst!
      });

      const rootRegInst: ACFuncBodyInst = { inst: "root_table.reg", envId: returnVar.envId, rootTableIdx: ast.rootIdx!, tmpVarIdx: returnVar.idx };
      prelude.push(rootRegInst);

      return { prelude, valInst: { inst: "func_frame.load_tmp", envId: returnVar.envId, idx: returnVar.idx } };
    } else {
      return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
    }
  }

  private codegenIf(ast: AstIfNode, defTypeMap: DefTypeMap): { prelude: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    const resultTmpId = this.#funcCtx.freshFuncTmpId;
    const isUnitType = tyEqual(ast.ty!, { tyKind: "primitive", name: "()" });

    if (!isUnitType) {
      prelude.push(
        { inst: "func_frame.deftmp_noval", envId: this.#funcCtx.funcEnvId, idx: resultTmpId, ty: ast.ty! }
      );
    }

    const { prelude: condPrelude, valInst: condValInst } = this.codegenExpr(ast.cond, defTypeMap);
    if (condPrelude) prelude = prelude.concat(condPrelude);

    let thenInsts: ACFuncBodyInst[] = [];
    const { prelude: thenPrelude, valInst: thenValInst } = this.codegenExprSeq(ast.then, defTypeMap);
    if (thenPrelude) thenInsts = thenInsts.concat(thenPrelude);

    let elseInsts: ACFuncBodyInst[] = [];
    const { prelude: elsePrelude, valInst: elseValInst } = this.codegenExprSeq(ast.else, defTypeMap);
    if (elsePrelude) elseInsts = elseInsts.concat(elsePrelude);

    if (isUnitType) {
      if (thenValInst) thenInsts.push(thenValInst);
      if (elseValInst) elseInsts.push(elseValInst);
    } else {
      thenInsts.push(
        { inst: "func_frame.store_tmp", envId: this.#funcCtx.funcEnvId, idx: resultTmpId, value: thenValInst! }
      );
      elseInsts.push(
        { inst: "func_frame.store_tmp", envId: this.#funcCtx.funcEnvId, idx: resultTmpId, value: elseValInst! }
      );
    }

    prelude.push(
      { inst: "ifelse", cond: condValInst!, then: thenInsts, else: elseInsts }
    );

    return {
      prelude,
      valInst: isUnitType ? undefined : { inst: "func_frame.load_tmp", envId: this.#funcCtx.funcEnvId, idx: resultTmpId }
    }
  }

  private codegenClosure(ast: AstFuncNode): { prelude: ACFuncBodyInst[], valInst?: ACPushValInst } {
    if (ast.closureId == null) {
      throw new Error("local func definition must have closureId");
    }
    const closureInst: ACClosureMakeInst = { inst: "closure.make", id: ast.closureId };

    const tmpId = this.#funcCtx.freshFuncTmpId;

    const defTmpInst: ACFuncBodyInst = { inst: "func_frame.deftmp", envId: this.#funcCtx.funcEnvId, idx: tmpId, ty: ast.ty!, value: closureInst };

    const rootRegInst: ACFuncBodyInst = { inst: "root_table.reg", envId: this.#funcCtx.funcEnvId, rootTableIdx: ast.rootIdx!, tmpVarIdx: tmpId };

    return {
      prelude: [defTmpInst, rootRegInst],
      valInst: { inst: "func_frame.load_tmp", envId: this.#funcCtx.funcEnvId, idx: tmpId }
    };
  }
}
