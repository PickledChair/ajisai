import {
  ACClosureDeclInst,
  ACClosureMakeInst,
  ACDeclInst,
  ACDefInst,
  ACEntryInst,
  ACFuncBodyInst,
  ACFuncDeclInst,
  ACFuncFrameDefTmpNoValInst,
  ACModInitDefInst,
  ACModInitBodyInst,
  ACModuleInst,
  ACPushValInst
} from "./acir.ts";

import {
  AstBinaryNode,
  AstCallNode,
  AstExprNode,
  AstExprSeqNode,
  AstIfNode,
  AstLetNode,
  AstFuncNode,
  AstUnaryNode,
  AstLocalVarNode,
  AstGlobalVarNode,
  AstDeclareNode
} from "./ast.ts";
import { ImportGraphNode } from "./import_graph.ts";

import {
  PrimitiveType,
  FuncType,
  Type,
  mayBeHeapObj,
  tyEqual
} from "./type.ts";

type ModuleInitializer = { nodeType: "modInitializer", items: ModuleInitItem[], envId: number, rootTableSize: number };
type ModuleInitItem = ExprStmtItem | ImportModItem | ValDefItem;
type ExprStmtItem = { itemType: "exprStmt", expr: AstExprNode };
type ImportModItem = { itemType: "importMod", modName: string };
type ValDefItem = { itemType: "valDef", declare: AstDeclareNode  };

export class CodeGenerator {
  #importGraph: ImportGraphNode;

  constructor(importGraph: ImportGraphNode) {
    this.#importGraph = importGraph;
  }

  codegen(): ACEntryInst {
    return {
      inst: "entry",
      entryMod: this.codegenModule(),
      globalRootTableSize: this.#importGraph.mod.globalRootTableSize!,
    };
  }

  private codegenModule(): ACModuleInst {
    let decls: ACDeclInst[] = [];
    let funcDefs: ACDefInst[] = [];
    let modInits: ACModInitDefInst[] = [];

    const modInitsNumMap: Map<string, { renamed: string, initsNum: number }> = new Map();

    for (const [asName, subImportGraph] of this.#importGraph.importMods.entries()) {
      const codeGen = new CodeGenerator(subImportGraph);
      const { decls: subDecls, funcDefs: subFuncDefs, modInits: subModInits } = codeGen.codegenModule();

      modInitsNumMap.set(asName, {
        renamed: subImportGraph.modName.renamed,
        initsNum: subModInits.length,
      });

      decls = subDecls.concat(decls);
      funcDefs = subFuncDefs.concat(funcDefs);
      modInits = subModInits.concat(modInits);
    }

    const modInitItems: ModuleInitItem[] = [];

    for (const item of this.#importGraph.mod.items) {
      if (item.nodeType === "import") {
        if (item.asName == null) throw new Error("unreachable");

        // NOTE: asName には意味解析フェーズでモジュール中での使用名が与えられている
        const modInitsNum = modInitsNumMap.get(item.asName.name);
        if (modInitsNum == null) throw new Error("unreachable");

        if (modInitsNum.initsNum > 0) {
          modInitItems.push({
            itemType: "importMod",
            modName: modInitsNum.renamed,
          });
        }
        continue;
      }

      if (item.nodeType === "exprStmt") {
        modInitItems.push({ itemType: "exprStmt", expr: item.expr });
        continue;
      }

      if (item.declare.nodeType === "moduleDeclare") continue;

      // declare
      if (item.declare.value.nodeType === "func") {
        if (item.declare.ty?.tyKind !== "func") throw new Error("unreachable");
        const funcCodeGen = new FuncCodeGenerator(
          item.declare.name,
          item.declare.ty!,
          item.declare.value as AstFuncNode,
          item.declare.modName!
        );
        const [funcDecl, funcDef] = funcCodeGen.codegenFunc();
        decls.push(funcDecl);
        funcDefs.push(funcDef);
      } else {
        if (!tyEqual(item.declare.ty!, { tyKind: "primitive", name: "()"})) {
          decls.push({
            inst: "val.decl",
            varName: item.declare.name,
            ty: item.declare.ty!,
            modName: item.declare.modName!,
          });
          modInitItems.push({ itemType: "valDef", declare: item.declare });
        }
      }
    }

    if (modInitItems.length > 0) {
      const modInitDef: ModuleInitializer = {
        nodeType: "modInitializer",
        items: modInitItems,
        envId: this.#importGraph.mod.envId,
        rootTableSize: this.#importGraph.mod.rootTableSize!,
      };
      const modInitCodeGen = new FuncCodeGenerator(
        "",
        {
          tyKind: "func",
          funcKind: "modinit",
          argTypes: [],
          bodyType: { tyKind: "primitive", name: "()" },
        },
        modInitDef,
        this.#importGraph.modName.renamed,
      );
      modInits.push(modInitCodeGen.codegenModInit());
    }

    return { inst: "module", decls, funcDefs, modInits, modName: this.#importGraph.modName.renamed };
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
    case "localVar": return expr.ty;
    case "globalVar": return expr.ty;
    case "unit": return { tyKind: "primitive", name: "()" };
  }
};

class FuncCodeGenerator {
  #funcTy: FuncType;
  #funcNode: AstFuncNode | ModuleInitializer;
  #funcCtx: FuncContext;
  #modName: string;

  constructor(funcName: string, funcTy: FuncType, func: AstFuncNode | ModuleInitializer, modName: string) {
    this.#funcTy = funcTy;
    this.#funcNode = func;
    this.#funcCtx = new FuncContext(funcName, func.envId);
    this.#modName = modName;
  }

  codegenFunc(): [ACDeclInst, ACDefInst] {
    if (this.#funcNode.nodeType === "modInitializer")
      throw new Error("function expected, but module initializer found");

    const funcDeclInst = this.makeFuncDeclInst();

    const body = this.codegenFuncBody(funcDeclInst.resultType);

    return [
      funcDeclInst,
      {
        inst: this.#funcNode.closureId == null ? "func.def" : "closure.def",
        funcName: funcDeclInst.funcName,
        args: funcDeclInst.args,
        resultType: funcDeclInst.resultType,
        modName: this.#modName,
        envId: this.#funcCtx.funcEnvId,
        body
      }
    ];
  }

  private makeFuncDeclInst(): ACFuncDeclInst | ACClosureDeclInst {
    if (this.#funcNode.nodeType === "modInitializer")
      throw new Error("function expected, but module initializer found");

    return {
      inst: this.#funcNode.closureId == null ? "func.decl" : "closure.decl",
      funcName: this.#funcCtx.funcName,
      args: this.#funcNode.args.map(arg => [arg.name, arg.ty!]),
      resultType: this.#funcTy.bodyType,
      modName: this.#modName
    };
  }

  codegenModInit(): ACModInitDefInst {
    const body = this.codegenModInitBody();
    return {
      inst: "mod_init.def",
      body,
      modName: this.#modName,
    };
  }

  private codegenFuncBody(resultType: Type): ACFuncBodyInst[] {
    if (this.#funcNode.nodeType === "modInitializer")
      throw new Error("function expected, but module initializer found");

    let bodyInsts: ACFuncBodyInst[]  = [];

    if (this.#funcNode.rootTableSize! > 0) {
      bodyInsts.push({ inst: "root_table.init", size: this.#funcNode.rootTableSize! });
    }
    bodyInsts.push({ inst: "func_frame.init", rootTableSize: this.#funcNode.rootTableSize! });

    const { prelude, valInst } = this.codegenExprSeq(this.#funcNode.body);

    if (prelude) {
      bodyInsts = bodyInsts.concat(prelude);
    }

    if (valInst) {
      if (tyEqual(resultType, { tyKind: "primitive", name: "()" })) {
        bodyInsts.push(valInst);
      } else {
        bodyInsts.push({ inst: "func.return", value: valInst });
      }
    }

    return bodyInsts;
  }

  private codegenModInitBody(): ACModInitBodyInst[] {
    if (this.#funcNode.nodeType === "func")
      throw new Error("module initializer expected, but function found");

    let bodyInsts: ACModInitBodyInst[]  = [];

    if (this.#funcNode.rootTableSize! > 0) {
      bodyInsts.push({ inst: "root_table.init", size: this.#funcNode.rootTableSize });
    }
    bodyInsts.push({ inst: "func_frame.init", rootTableSize: this.#funcNode.rootTableSize });

    for (const item of this.#funcNode.items) {
      if (item.itemType === "importMod") {
        bodyInsts.push({ inst: "mod.init", modName: item.modName });
        continue;
      }

      if (item.itemType === "valDef") {
        const { prelude, valInst } = this.codegenExpr(item.declare.value);
        if (prelude) bodyInsts = bodyInsts.concat(prelude);
        if (valInst) {
          bodyInsts.push({
            inst: "mod_val.init",
            varName: item.declare.name,
            modName: item.declare.modName!,
            value: valInst,
          });
          if (item.declare.globalRootIdx != null) {
            bodyInsts.push({
              inst: "global_root_table.reg",
              idx: item.declare.globalRootIdx,
              varName: item.declare.name,
              modName: item.declare.modName!,
            });
          }
        }
        continue;
      }

      // ExprStmtItem
      const { prelude, valInst } = this.codegenExpr(item.expr);
      if (prelude) bodyInsts = bodyInsts.concat(prelude);
      if (valInst) bodyInsts.push(valInst);
    }

    return bodyInsts;
  }

  private codegenExpr(ast: AstExprNode): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    switch (ast.nodeType) {
      case "func":
        return this.codegenClosure(ast);
      case "unary":
        return this.codegenUnary(ast);
      case "binary":
        return this.codegenBinary(ast);
      case "call":
        return this.codegenCall(ast);
      case "let":
        return this.codegenLet(ast);
      case "if":
        return this.codegenIf(ast);
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
      case "localVar":
        return this.codegenLocalVar(ast);
      case "globalVar":
        return this.codegenGlobalVar(ast);
      default:
        throw new Error(`invalid expr node: ${ast.nodeType}`);
    }
  }

  private codegenUnary(ast: AstUnaryNode): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    const { prelude: opePrelude, valInst: opeValInst } = this.codegenExpr(ast.operand);
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

  private codegenBinary(ast: AstBinaryNode): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    const { prelude: leftPrelude, valInst: leftValInst } = this.codegenExpr(ast.left);
    const { prelude: rightPrelude, valInst: rightValInst } = this.codegenExpr(ast.right);

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

  private codegenCall(ast: AstCallNode): { prelude?: ACFuncBodyInst[], valInst: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    const { prelude: calleePrelude, valInst: calleeValInst } = this.codegenExpr(ast.callee);

    if (calleePrelude) prelude = prelude.concat(calleePrelude);
    const args: ACPushValInst[] = [];

    for (const arg of ast.args) {
      const { prelude: argPrelude, valInst } = this.codegenExpr(arg);
      if (argPrelude) prelude = prelude.concat(argPrelude);

      if (arg.nodeType === "globalVar" &&
          arg.ty!.tyKind === "func" &&
          arg.ty!.funcKind !== "closure") {
        const closureId = this.#funcCtx.freshFuncTmpId;

        prelude.push({
          inst: "closure.make_static",
          id: closureId,
          funcKind: arg.ty!.funcKind,
          name: arg.name,
          modName: arg.ty!.funcKind === "builtin" ? undefined : this.#modName
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

  private codegenLocalVar(ast: AstLocalVarNode): { valInst: ACPushValInst } {
    return { valInst: { inst: "env.load", envId: ast.toEnv, varName: ast.name } };
  }

  private codegenGlobalVar(ast: AstGlobalVarNode): { valInst: ACPushValInst } {
    const varTy = ast.ty;
    if (varTy) {
      if (varTy.tyKind === "func") {
        if (varTy.funcKind === "userdef") {
          return { valInst: { inst: "mod_defs.load", varName: ast.name, modName: ast.modName! } };
        } else if (varTy.funcKind === "closure") {
          return { valInst: { inst: "closure.load", id: ast.name} };
        } else if (varTy.funcKind === "builtin") {
          return { valInst: { inst: "builtin.load", varName: ast.name } };
        }
        throw new Error("unreachable");
      } else {
        return { valInst: { inst: "mod_defs.load", varName: ast.name, modName: ast.modName! } };
      }
    } else {
      throw new Error("unreachable");
    }
  }

  private codegenExprSeq(ast: AstExprSeqNode): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    let valInst: ACPushValInst | undefined = undefined;

    ast.exprs.forEach((expr, idx) => {
      const { prelude: exprPrelude, valInst: exprValInst } = this.codegenExpr(expr);
      if (exprPrelude) prelude = prelude.concat(exprPrelude);

      if (idx === ast.exprs.length - 1) {
        valInst = exprValInst;
      } else {
        if (exprValInst) prelude.push(exprValInst);
      }
    });

    return { prelude: prelude.length === 0 ? undefined : prelude, valInst };
  }

  private codegenLet(ast: AstLetNode): { prelude?: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];

    this.#funcCtx.enterScope(ast.envId);

    let returnVar: ACFuncFrameDefTmpNoValInst | undefined;
    if (mayBeHeapObj(ast.bodyTy!)) {
      returnVar = { inst: "func_frame.deftmp_noval", envId: this.#funcCtx.funcEnvId, idx: this.#funcCtx.freshFuncTmpId, ty: ast.bodyTy! };
      prelude.push(returnVar);
    }

    for (const { name, value, ty } of ast.declares) {
      const { prelude: valPrelude, valInst } = this.codegenExpr(value);
      if (valPrelude) prelude = prelude.concat(valPrelude);

      if (value.nodeType === "globalVar" && value.ty!.tyKind === "func" && value.ty!.funcKind !== "closure") {
        const closureId = this.#funcCtx.freshFuncTmpId;

        prelude.push({
          inst: "closure.make_static",
          id: closureId,
          funcKind: value.ty!.funcKind,
          name: value.name,
          modName: value.ty!.funcKind === "builtin" ? undefined : this.#modName
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

    const { prelude: bodyPrelude, valInst: valInst_ } = this.codegenExprSeq(ast.body);
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

  private codegenIf(ast: AstIfNode): { prelude: ACFuncBodyInst[], valInst?: ACPushValInst } {
    let prelude: ACFuncBodyInst[] = [];
    const resultTmpId = this.#funcCtx.freshFuncTmpId;
    const isUnitType = tyEqual(ast.ty!, { tyKind: "primitive", name: "()" });

    if (!isUnitType) {
      prelude.push(
        { inst: "func_frame.deftmp_noval", envId: this.#funcCtx.funcEnvId, idx: resultTmpId, ty: ast.ty! }
      );
    }

    const { prelude: condPrelude, valInst: condValInst } = this.codegenExpr(ast.cond);
    if (condPrelude) prelude = prelude.concat(condPrelude);

    let thenInsts: ACFuncBodyInst[] = [];
    const { prelude: thenPrelude, valInst: thenValInst } = this.codegenExprSeq(ast.then);
    if (thenPrelude) thenInsts = thenInsts.concat(thenPrelude);

    let elseInsts: ACFuncBodyInst[] = [];
    const { prelude: elsePrelude, valInst: elseValInst } = this.codegenExprSeq(ast.else);
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
