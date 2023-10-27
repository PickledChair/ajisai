import { Type } from "./type.ts";

export type ACModuleInst = {
  inst: "module",
  procDecls: ACDeclInst[],
  procDefs: ACDefInst[],
  entry?: ACEntryInst
};

export type ACDeclInst = ACProcDeclInst | ACClosureDeclInst;
export type ACDefInst = ACProcDefInst | ACClosureDefInst;

export type ACEntryInst = { inst: "entry", body: ACProcBodyInst[] };

export type ACProcDeclInst = { inst: "proc.decl", procName: string, args: [string, Type][], resultType: Type };
export type ACProcDefInst = {
  inst: "proc.def", procName: string, args: [string, Type][], resultType: Type,
  envId: number,
  body: ACProcBodyInst[]
};

export type ACClosureDeclInst = { inst: "closure.decl", procName: string, args: [string, Type][], resultType: Type };
export type ACClosureDefInst = {
  inst: "closure.def", procName: string, args: [string, Type][], resultType: Type,
  envId: number,
  body: ACProcBodyInst[]
};

export type ACProcBodyInst =
  ACRootTableInitInst | ACRootTableRegInst | ACRootTableUnregInst |
  ACProcFrameInitInst | ACProcFrameDefTmpInst | ACProcFrameDefTmpNoValInst | ACProcFrameStoreTmpInst |
  ACProcReturnInst |
  ACEnvDefVarInst |
  ACIfElseInst |
  ACStrMakeStaticInst |
  ACPushValInst;

export type ACEnvDefVarInst = { inst: "env.defvar", envId: number, varName: string, ty: Type, value: ACPushValInst };
export type ACEnvLoadInst = { inst: "env.load", envId: number, varName: string };
export type ACModDefsLoadInst = { inst: "mod_defs.load", varName: string };
export type ACBuiltinLoadInst = { inst: "builtin.load", varName: string };
export type ACClosureLoadInst = { inst: "closure.load", id: string }

export type ACRootTableInitInst = { inst: "root_table.init", size: number };
export type ACRootTableRegInst = { inst: "root_table.reg", envId: number, rootTableIdx: number, tmpVarIdx: number };
export type ACRootTableUnregInst = { inst: "root_table.unreg", idx: number };

export type ACProcFrameInitInst = { inst: "proc_frame.init", rootTableSize: number };
export type ACProcFrameDefTmpInst = { inst: "proc_frame.deftmp", envId: number, idx: number, ty: Type, value: ACPushValInst };
export type ACProcFrameDefTmpNoValInst = { inst: "proc_frame.deftmp_noval", envId: number, idx: number, ty: Type };
export type ACProcFrameLoadTmpInst = { inst: "proc_frame.load_tmp", envId: number, idx: number };
export type ACProcFrameStoreTmpInst = { inst: "proc_frame.store_tmp", envId: number, idx: number, value: ACPushValInst };

export type ACProcReturnInst = { inst: "proc.return", value: ACPushValInst };

export type ACIfElseInst = { inst: "ifelse", cond: ACPushValInst, then: ACProcBodyInst[], else: ACProcBodyInst[] };

export type ACPushValInst =
  ACBuiltinLoadInst |
  ACModDefsLoadInst |
  ACClosureLoadInst |
  ACEnvLoadInst |
  ACProcFrameLoadTmpInst |
  ACBuiltinCallInst | ACBuiltinCallWithFrameInst | ACProcCallInst | ACClosureCallInst |

  ACI32ConstInst | ACI32NegInst | ACI32AddInst | ACI32SubInst | ACI32MulInst | ACI32DivInst | ACI32ModInst |
  ACI32EqInst | ACI32NeInst | ACI32LtInst | ACI32LeInst | ACI32GtInst | ACI32GeInst |

  ACBoolConstInst | ACBoolNotInst | ACBoolEqInst | ACBoolNeInst | ACBoolAndInst | ACBoolOrInst |

  ACStrConstInst |

  ACClosureMakeInst;

export type ACBuiltinCallInst = { inst: "builtin.call", callee: ACPushValInst, args: ACPushValInst[] };
export type ACBuiltinCallWithFrameInst = { inst: "builtin.call_with_frame", callee: ACPushValInst, args: ACPushValInst[] };
export type ACProcCallInst = { inst: "proc.call", callee: ACPushValInst, args: ACPushValInst[] };
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

export type ACClosureMakeInst = { inst: "closure.make", id: number };
