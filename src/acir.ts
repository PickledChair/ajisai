import { FuncKind, Type } from "./type.ts";

export type ACModuleInst = {
  inst: "module",
  funcDecls: ACDeclInst[],
  funcDefs: ACDefInst[],
  modInits: ACModInitDefInst[],
  entryModName: string,
};

export type ACDeclInst = ACFuncDeclInst | ACClosureDeclInst;
export type ACDefInst = ACFuncDefInst | ACClosureDefInst;

// export type ACEntryInst = { inst: "entry", body: ACFuncBodyInst[] };
export type ACModInitBodyInst = ACFuncBodyInst | ACModInitInst;
export type ACModInitInst = { inst: "mod.init", modName: string };
export type ACModInitDefInst = { inst: "mod_init.def" , body: ACModInitBodyInst[], modName: string };

export type ACFuncDeclInst = {
  inst: "func.decl", funcName: string, args: [string, Type][], resultType: Type,
  modName: string
};
export type ACFuncDefInst = {
  inst: "func.def", funcName: string, args: [string, Type][], resultType: Type,
  modName: string,
  envId: number,
  body: ACFuncBodyInst[]
};

export type ACClosureDeclInst = { inst: "closure.decl", funcName: string, args: [string, Type][], resultType: Type };
export type ACClosureDefInst = {
  inst: "closure.def", funcName: string, args: [string, Type][], resultType: Type,
  envId: number,
  body: ACFuncBodyInst[]
};

export type ACFuncBodyInst =
  ACRootTableInitInst | ACRootTableRegInst | ACRootTableUnregInst |
  ACFuncFrameInitInst | ACFuncFrameDefTmpInst | ACFuncFrameDefTmpNoValInst | ACFuncFrameStoreTmpInst |
  ACFuncReturnInst |
  ACEnvDefVarInst |
  ACIfElseInst |
  ACStrMakeStaticInst | ACClosureMakeStaticInst |
  ACPushValInst;

export type ACEnvDefVarInst = { inst: "env.defvar", envId: number, varName: string, ty: Type, value: ACPushValInst };
export type ACEnvLoadInst = { inst: "env.load", envId: number, varName: string };
export type ACModDefsLoadInst = { inst: "mod_defs.load", modName: string, varName: string };
export type ACBuiltinLoadInst = { inst: "builtin.load", varName: string };
export type ACClosureLoadInst = { inst: "closure.load", id: string };

export type ACRootTableInitInst = { inst: "root_table.init", size: number };
export type ACRootTableRegInst = { inst: "root_table.reg", envId: number, rootTableIdx: number, tmpVarIdx: number };
export type ACRootTableUnregInst = { inst: "root_table.unreg", idx: number };

export type ACFuncFrameInitInst = { inst: "func_frame.init", rootTableSize: number };
export type ACFuncFrameDefTmpInst = { inst: "func_frame.deftmp", envId: number, idx: number, ty: Type, value: ACPushValInst };
export type ACFuncFrameDefTmpNoValInst = { inst: "func_frame.deftmp_noval", envId: number, idx: number, ty: Type };
export type ACFuncFrameLoadTmpInst = { inst: "func_frame.load_tmp", envId: number, idx: number };
export type ACFuncFrameStoreTmpInst = { inst: "func_frame.store_tmp", envId: number, idx: number, value: ACPushValInst };

export type ACFuncReturnInst = { inst: "func.return", value: ACPushValInst };

export type ACIfElseInst = { inst: "ifelse", cond: ACPushValInst, then: ACFuncBodyInst[], else: ACFuncBodyInst[] };

export type ACPushValInst =
  ACBuiltinLoadInst |
  ACModDefsLoadInst |
  ACClosureLoadInst |
  ACEnvLoadInst |
  ACFuncFrameLoadTmpInst |
  ACFuncCallInst | ACClosureCallInst |

  ACI32ConstInst | ACI32NegInst | ACI32AddInst | ACI32SubInst | ACI32MulInst | ACI32DivInst | ACI32ModInst |
  ACI32EqInst | ACI32NeInst | ACI32LtInst | ACI32LeInst | ACI32GtInst | ACI32GeInst |

  ACBoolConstInst | ACBoolNotInst | ACBoolEqInst | ACBoolNeInst | ACBoolAndInst | ACBoolOrInst |

  ACStrConstInst |

  ACClosureConstInst | ACClosureMakeInst;

export type ACFuncCallInst = { inst: "func.call", callee: ACPushValInst, args: ACPushValInst[] };
export type ACClosureCallInst = { inst: "closure.call", callee: ACPushValInst, args: ACPushValInst[], argTypes: Type[], bodyType: Type };

export type ACI32ConstInst = { inst: "i32.const", value: number };
export type ACI32NegInst = { inst: "i32.neg", operand: ACPushValInst };
export type ACI32AddInst = { inst: "i32.add", left: ACPushValInst, right: ACPushValInst };
export type ACI32SubInst = { inst: "i32.sub", left: ACPushValInst, right: ACPushValInst };
export type ACI32MulInst = { inst: "i32.mul", left: ACPushValInst, right: ACPushValInst };
export type ACI32DivInst = { inst: "i32.div", left: ACPushValInst, right: ACPushValInst };
export type ACI32ModInst = { inst: "i32.mod", left: ACPushValInst, right: ACPushValInst };
export type ACI32EqInst = { inst: "i32.eq", left: ACPushValInst, right: ACPushValInst };
export type ACI32NeInst = { inst: "i32.ne", left: ACPushValInst, right: ACPushValInst };
export type ACI32LtInst = { inst: "i32.lt", left: ACPushValInst, right: ACPushValInst };
export type ACI32LeInst = { inst: "i32.le", left: ACPushValInst, right: ACPushValInst };
export type ACI32GtInst = { inst: "i32.gt", left: ACPushValInst, right: ACPushValInst };
export type ACI32GeInst = { inst: "i32.ge", left: ACPushValInst, right: ACPushValInst };

export type ACBoolConstInst = { inst: "bool.const", value: boolean };
export type ACBoolNotInst = { inst: "bool.not", operand: ACPushValInst };
export type ACBoolEqInst = { inst: "bool.eq", left: ACPushValInst, right: ACPushValInst };
export type ACBoolNeInst = { inst: "bool.ne", left: ACPushValInst, right: ACPushValInst };
export type ACBoolAndInst = { inst: "bool.and", left: ACPushValInst, right: ACPushValInst };
export type ACBoolOrInst = { inst: "bool.or", left: ACPushValInst, right: ACPushValInst };

export type ACStrMakeStaticInst = { inst: "str.make_static", id: number, value: string, len: number };
export type ACStrConstInst = { inst: "str.const", id: number };

export type ACClosureMakeStaticInst = { inst: "closure.make_static", id: number, funcKind: FuncKind, name: string, modName?: string };
export type ACClosureConstInst = { inst: "closure.const", id: number };
export type ACClosureMakeInst = { inst: "closure.make", id: number };
