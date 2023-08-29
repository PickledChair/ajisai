import { Type } from "./type.ts";

export type ACModuleInst = {
  inst: "module",
  procDecls: ACProcDeclInst[],
  procDefs: ACProcDefInst[],
  entry?: ACEntryInst
};

export type ACEntryInst = { inst: "entry", body: ACProcBodyInst[] };
export type ACProcDeclInst = { inst: "proc.decl", procName: string, args: [string, Type][], resultType: Type };
export type ACProcDefInst = {
  inst: "proc.def", procName: string, args: [string, Type][], resultType: Type,
  envId: number,
  body: ACProcBodyInst[]
};

export type ACProcBodyInst =
  ACProcEnvInitInst | ACProcReturnInst |
  ACLetEnvDefVarInst |
  ACProcEnvDefTmp | ACProcEnvDefTmpNoVal | ACProcEnvStoreTmp |
  ACIfElseInst |
  ACPushValInst;

export type ACLetEnvDefVarInst = { inst: "let_env.defvar", envId: number, varName: string, ty: Type, value: ACPushValInst };
export type ACEnvLoadInst = { inst: "env.load", envId: number, varName: string };
export type ACModDefsLoadInst = { inst: "mod_defs.load", varName: string };
export type ACBuiltinLoadInst = { inst: "builtin.load", varName: string };

export type ACProcEnvInitInst = { inst: "proc_env.init" }
export type ACProcEnvDefTmp = { inst: "proc_env.deftmp", envId: number, idx: number, ty: Type, value: ACPushValInst };
export type ACProcEnvDefTmpNoVal = { inst: "proc_env.deftmp_noval", envId: number, idx: number, ty: Type };
export type ACProcEnvLoadTmp = { inst: "proc_env.load_tmp", envId: number, idx: number };
export type ACProcEnvStoreTmp = { inst: "proc_env.store_tmp", envId: number, idx: number, value: ACPushValInst };
export type ACProcReturnInst = { inst: "proc.return", value: ACPushValInst };

export type ACIfElseInst = { inst: "ifelse", cond: ACPushValInst, then: ACProcBodyInst[], else: ACProcBodyInst[] };

export type ACPushValInst =
  ACBuiltinLoadInst |
  ACModDefsLoadInst |
  ACEnvLoadInst |
  ACProcEnvLoadTmp |
  ACBuiltinCallInst | ACProcCallInst |

  ACI32ConstInst | ACI32NegInst | ACI32AddInst | ACI32SubInst | ACI32MulInst | ACI32DivInst |
  ACI32EqInst | ACI32NeInst | ACI32LtInst | ACI32LeInst | ACI32GtInst | ACI32GeInst |

  ACBoolConstInst | ACBoolNotInst | ACBoolEqInst | ACBoolNeInst | ACBoolAndInst | ACBoolOrInst;

export type ACBuiltinCallInst = { inst: "builtin.call", callee: ACPushValInst, args: ACPushValInst[] };
export type ACProcCallInst = { inst: "proc.call", callee: ACPushValInst, args: ACPushValInst[] };

export type ACI32ConstInst = { inst: "i32.const", value: number };
export type ACI32NegInst = { inst: "i32.neg", operand: ACPushValInst };
export type ACI32AddInst = { inst: "i32.add", left: ACPushValInst, right: ACPushValInst };
export type ACI32SubInst = { inst: "i32.sub", left: ACPushValInst, right: ACPushValInst };
export type ACI32MulInst = { inst: "i32.mul", left: ACPushValInst, right: ACPushValInst };
export type ACI32DivInst = { inst: "i32.div", left: ACPushValInst, right: ACPushValInst };
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
