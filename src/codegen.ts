import { ACEntryInst, ACModuleInst, ACProcBodyInst, ACProcDeclInst, ACProcDefInst, ACPushValInst } from "./acir.ts";
import {
  AstBinaryNode,
  AstCallNode,
  AstExprNode,
  AstExprSeqNode,
  AstIfNode,
  AstLetNode,
  AstModuleNode,
  AstProcNode,
  AstUnaryNode,
  AstVariableNode
} from "./ast.ts";
import { DefTypeMap } from "./semant.ts";
import { PrimitiveType, ProcType, Type, mayBeHeapObj, tyEqual } from "./type.ts";

export class CodeGenerator {
  #module: AstModuleNode;
  #defTypeMap: DefTypeMap;

  constructor(module: AstModuleNode, defTypeMap: DefTypeMap) {
    this.#module = module;
    this.#defTypeMap = defTypeMap;
  }

  codegen(): ACModuleInst {
    const procDecls = [];
    const procDefs = [];
    let entry = undefined;

    for (const def of this.#module.defs) {
      if (def.declare.ty!.tyKind === "proc") {
        const procCodeGen = new ProcCodeGenerator(def.declare.name, def.declare.ty!, def.declare.value as AstProcNode);
        const [procDecl, procDef] = procCodeGen.codegen(this.#defTypeMap);
        if (procDecl) procDecls.push(procDecl);
        if (procDef.inst === "proc.def") {
          procDefs.push(procDef);
        } else if (procDef.inst === "entry") {
          entry = procDef;
        }
      }
    }

    return { inst: "module", procDecls, procDefs, entry };
  }
}

type EnvContext = { envId: number, isProcEnv: boolean };

class ProcContext {
  procName: string;
  #envStack: EnvContext[];
  #freshTmpId = 0;

  constructor(procName: string, envId: number) {
    this.procName = procName;
    this.#envStack = [];
    this.#envStack.push({ envId, isProcEnv: true });
  }

  enterScope(envId: number) {
    this.#envStack.push({ envId, isProcEnv: false });
  }

  leaveScope() {
    this.#envStack.pop();
  }

  get currentEnvId(): number {
    return this.#envStack.at(-1)!.envId;
  }

  get freshProcTmpId(): number {
    return this.#freshTmpId++;
  }

  currentEnvIsProc(): boolean {
    return this.#envStack.at(-1)!.isProcEnv;
  }

  get procEnvId(): number {
    return this.#envStack.at(0)!.envId;
  }
}

const getExprType = (expr: AstExprNode): Type | undefined => {
  switch (expr.nodeType) {
    case "proc": return expr.bodyTy;
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

class ProcCodeGenerator {
  #procTy: ProcType;
  #procNode: AstProcNode;
  #procCtx: ProcContext;

  constructor(procName: string, procTy: ProcType, proc: AstProcNode) {
    this.#procTy = procTy;
    this.#procNode = proc;
    this.#procCtx = new ProcContext(procName, proc.envId);
  }

  codegen(defTypeMap: DefTypeMap): [ACProcDeclInst | undefined, ACProcDefInst | ACEntryInst] {
    const procDeclInst = this.makeProcDeclInst();

    let bodyInsts: ACProcBodyInst[]  = [];
    if (this.#procNode.rootTableSize! > 0) {
      bodyInsts.push({ inst: "root_table.init", size: this.#procNode.rootTableSize! });
    }
    bodyInsts.push({ inst: "proc_frame.init", rootTableSize: this.#procNode.rootTableSize! });

    const { prelude, valInst } = this.codegenExprSeq(this.#procNode.body, defTypeMap);

    if (prelude) {
      bodyInsts = bodyInsts.concat(prelude);
    }

    if (valInst) {
      if (tyEqual(procDeclInst.resultType, { tyKind: "primitive", name: "()" })) {
        bodyInsts.push(valInst);
      } else {
        bodyInsts.push({ inst: "proc.return", value: valInst });
      }
    }

    if (procDeclInst.procName === "main") {
      return [
        undefined,
        { inst: "entry", body: bodyInsts }
      ];
    } else {
      return [
        procDeclInst,
        {
          inst: "proc.def",
          procName: procDeclInst.procName,
          args: procDeclInst.args,
          resultType: procDeclInst.resultType,
          envId: this.#procCtx.procEnvId,
          body: bodyInsts
        }
      ];
    }
  }

  private makeProcDeclInst(): ACProcDeclInst {
    return {
      inst: "proc.decl",
      procName: this.#procCtx.procName,
      args: this.#procNode.args.map(arg => [arg.name, arg.ty!]),
      resultType: this.#procTy.bodyType
    };
  }

  private codegenExpr(ast: AstExprNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst?: ACPushValInst } {
    switch (ast.nodeType) {
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
        const strId = this.#procCtx.freshProcTmpId;
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

  private codegenUnary(ast: AstUnaryNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst: ACPushValInst } {
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

  private codegenBinary(ast: AstBinaryNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst: ACPushValInst } {
    const { prelude: leftPrelude, valInst: leftValInst } = this.codegenExpr(ast.left, defTypeMap);
    const { prelude: rightPrelude, valInst: rightValInst } = this.codegenExpr(ast.right, defTypeMap);

    let prelude: ACProcBodyInst[] | undefined = undefined;
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

  private codegenCall(ast: AstCallNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst: ACPushValInst } {
    let prelude: ACProcBodyInst[] = [];
    const { prelude: calleePrelude, valInst: calleeValInst } = this.codegenExpr(ast.callee, defTypeMap);

    if (calleePrelude) prelude = prelude.concat(calleePrelude);
    const args = [];

    for (const arg of ast.args) {
      const { prelude: argPrelude, valInst } = this.codegenExpr(arg, defTypeMap);
      if (argPrelude) prelude = prelude.concat(argPrelude);
      args.push(valInst!);
    }

    if (ast.callee.nodeType === "variable") {
      const varTy = defTypeMap.get(ast.callee.name);
      if (varTy && varTy.tyKind === "proc") {
        let valInst: ACPushValInst;

        if (varTy.procKind === "builtin") {
          valInst = { inst: "builtin.call", callee: calleeValInst!, args };
        } else if (varTy.procKind === "builtinWithFrame") {
          valInst = { inst: "builtin.call_with_frame", callee: calleeValInst!, args };
        } else if (varTy.procKind === "userdef") {
          valInst = { inst: "proc.call", callee: calleeValInst!, args };
        } else {
          throw new Error("unimplemented for other proc type");
        }

        if (mayBeHeapObj(varTy.bodyType)) {
          const tmpId = this.#procCtx.freshProcTmpId;

          const defTmpInst: ACProcBodyInst = { inst: "proc_frame.deftmp", envId: this.#procCtx.procEnvId, idx: tmpId, ty: ast.ty!, value: valInst };
          prelude.push(defTmpInst);

          const rootRegInst: ACProcBodyInst = { inst: "root_table.reg", envId: this.#procCtx.procEnvId, rootTableIdx: ast.rootIdx!, tmpVarIdx: tmpId };
          prelude.push(rootRegInst);

          valInst = { inst: "proc_frame.load_tmp", envId: this.#procCtx.procEnvId, idx: tmpId };
        }

        return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
      } else {
        throw new Error("unreachable");
      }
    } else {
      throw new Error("unimplemented for calling proc literal directly");
    }
  }

  private codegenVariable(ast: AstVariableNode, defTypeMap: DefTypeMap): { valInst: ACPushValInst } {
    if (ast.level === -1) {
      const varTy = defTypeMap.get(ast.name);
      if (varTy) {
        if (varTy.tyKind === "proc") {
          if (varTy.procKind === "userdef") {
            return { valInst: { inst: "mod_defs.load", varName: ast.name } };
          } else if (varTy.procKind === "builtin" || varTy.procKind === "builtinWithFrame") {
            return { valInst: { inst: "builtin.load", varName: ast.name } };
          }
          throw new Error("unreachable");
        } else {
          throw new Error("unimplemented for non-proc def load");
        }
      } else {
        throw new Error(`variable '${ast.name}' not found`);
      }
    } else {
      return { valInst: { inst: "env.load", envId: ast.toEnv, varName: ast.name } };
    }
  }

  private codegenExprSeq(ast: AstExprSeqNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACProcBodyInst[] = [];
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

  private codegenLet(ast: AstLetNode, defTypeMap: DefTypeMap): { prelude?: ACProcBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACProcBodyInst[] = [];

    this.#procCtx.enterScope(ast.envId);

    for (const { name, value } of ast.declares) {
      const { prelude: valPrelude, valInst } = this.codegenExpr(value, defTypeMap);
      if (valPrelude) prelude = prelude.concat(valPrelude);
      prelude.push(
        { inst: "env.defvar", envId: ast.envId, varName: name, ty: getExprType(value)!, value: valInst! }
      );
    }

    const { prelude: bodyPrelude, valInst } = this.codegenExprSeq(ast.body, defTypeMap);
    if (bodyPrelude) prelude = prelude.concat(bodyPrelude);

    // if (ast.rootIndices!.length !== 0) {
    //   for (const idx of ast.rootIndices!) {
    //     const unregInst: ACProcBodyInst = { inst: "root_table.unreg", idx };
    //     prelude.push(unregInst);
    //   }
    // }
    this.#procCtx.leaveScope();
    return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
  }

  private codegenIf(ast: AstIfNode, defTypeMap: DefTypeMap): { prelude: ACProcBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACProcBodyInst[] = [];
    const resultTmpId = this.#procCtx.freshProcTmpId;
    const isUnitType = tyEqual(ast.ty!, { tyKind: "primitive", name: "()" });

    if (!isUnitType) {
      prelude.push(
        { inst: "proc_frame.deftmp_noval", envId: this.#procCtx.procEnvId, idx: resultTmpId, ty: ast.ty! }
      );
    }

    const { prelude: condPrelude, valInst: condValInst } = this.codegenExpr(ast.cond, defTypeMap);
    if (condPrelude) prelude = prelude.concat(condPrelude);

    let thenInsts: ACProcBodyInst[] = [];
    const { prelude: thenPrelude, valInst: thenValInst } = this.codegenExprSeq(ast.then, defTypeMap);
    if (thenPrelude) thenInsts = thenInsts.concat(thenPrelude);

    let elseInsts: ACProcBodyInst[] = [];
    const { prelude: elsePrelude, valInst: elseValInst } = this.codegenExprSeq(ast.else, defTypeMap);
    if (elsePrelude) elseInsts = elseInsts.concat(elsePrelude);

    if (isUnitType) {
      if (thenValInst) thenInsts.push(thenValInst);
      if (elseValInst) elseInsts.push(elseValInst);
    } else {
      thenInsts.push(
        { inst: "proc_frame.store_tmp", envId: this.#procCtx.procEnvId, idx: resultTmpId, value: thenValInst! }
      );
      elseInsts.push(
        { inst: "proc_frame.store_tmp", envId: this.#procCtx.procEnvId, idx: resultTmpId, value: elseValInst! }
      );
    }

    prelude.push(
      { inst: "ifelse", cond: condValInst!, then: thenInsts, else: elseInsts }
    );

    return {
      prelude,
      valInst: isUnitType ? undefined : { inst: "proc_frame.load_tmp", envId: this.#procCtx.procEnvId, idx: resultTmpId }
    }
  }
}
