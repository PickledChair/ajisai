import { AstDefNode, AstIfNode, AstLetNode, AstModuleNode, AstNode } from "./ast.ts";

let tmpVarId = 0;

type ProcInfo = { envId: number, returnCType: string, argInfos: { argName: string, argCType: string }[] };
type ProcInfoMap = Map<string, ProcInfo>;

const procInfoMap: ProcInfoMap = new Map();
const procEnvIds: number[] = [];

const defaultDeclares = `typedef struct EnvHeader EnvHeader;
struct EnvHeader {
  EnvHeader *parent;
};

void ajisai_println_i32(int32_t value) {
  printf("%d\\n", value);
}

void ajisai_println_bool(bool value) {
  printf("%s\\n", value ? "true" : "false");
}`;

export const codegen = (ast: AstModuleNode): string => {
  let declares = defaultDeclares;
  let procs = "";

  for (const def of ast.defs) {
    const { procDef, envStruct } = codegenDef(def);
    declares += "\n\n" + envStruct;
    procs += "\n\n" + procDef;
  }

  return `#include <stdbool.h>
#include <stdio.h>
#include <stdint.h>

${declares}${procs}

int main() {
  ajisai_main();
  return 0;
}
`;
};

const codegenDef = (ast: AstDefNode): { procDef: string, envStruct: string } => {
  if (ast.declare.value.nodeType !== "proc") {
    throw new Error("unimplemented for global variable");
  }
  const defTy = ast.declare.ty!;
  if (defTy.tyKind !== "proc") {
    throw new Error("unimplemented for global variable");
  }

  const procName = getProcName(ast.declare.name);
  let procDef = "";

  let envStruct = "";

  // TODO: builtin関数かどうかを調べる方法欲しい
  if (procName.startsWith("userdef") || procName === "ajisai_main") {
    if (procName.startsWith("userdef")) procEnvIds.push(ast.declare.value.envId);
    procDef += `int ${procName}(`;
    const procEnvName = `Env${ast.declare.value.envId}`;

    const argInfos = [];

    let isVoidFunc = true;
    if (procName !== "ajisai_main") {
      envStruct += `struct ${procEnvName} {\n  EnvHeader header;`;
      for (let i = 0; i < ast.declare.value.args.length; i++) {
        const { name: argName } = ast.declare.value.args[i];
        const argTy = defTy.argTypes[i];
        let tyStr;
        if (argTy.tyKind === "builtin") {
          if (argTy.name === "i32") {
            tyStr = "int32_t";
          } else if (argTy.name === "bool") {
            tyStr = "bool";
          } else {
            throw new Error("void type argument");
          }
        } else {
          throw new Error("unimplemented for non-builtin type argument");
        }
        argInfos.push({ argName, argCType: tyStr });
        envStruct += `\n  ${tyStr} arg_${argName};`;
      }
      let returnCType = "void";

      if (defTy.bodyType.tyKind === "builtin") {
        if (defTy.bodyType.name === "i32") {
          returnCType = "int32_t";
          isVoidFunc = false;
          envStruct += "\n  int32_t result;";
        } else if (defTy.bodyType.name === "bool") {
          returnCType = "bool";
          isVoidFunc = false;
          envStruct += "\n  bool result;";
        }
      }
      procInfoMap.set(procName, { envId: ast.declare.value.envId, returnCType, argInfos });
      envStruct += "\n};";

      procDef += `struct ${procEnvName} *env${ast.declare.value.envId}`
    }

    procDef += ") {\n";

    const { expr, prelude, envStruct: exprEnvStruct } = codegenExpr(ast.declare.value.body, 0);
    if (prelude) procDef += prelude;

    if (!isVoidFunc) procDef += `\n  env${ast.declare.value.envId}->result = ${expr};`;
    procDef += "\n  return 0;\n}";

    if (exprEnvStruct) {
      envStruct += `\n\n${exprEnvStruct}`;
    }

    return { procDef, envStruct };
  } else {
    throw new Error("define proc with builtin proc name");
  }
};

const getProcName = (name: string): string => {
  if (["main", "println_i32", "println_bool"].includes(name)) {
    return `ajisai_${name}`;
  } else {
    return `userdef_${name}`;
  }
};

const codegenExpr = (ast: AstNode, envId: number): { expr: string, prelude?: string, envStruct?: string } => {
  switch (ast.nodeType) {
    case "binary": {
      let prelude = "";
      let envStruct = "";

      const { expr: leftExpr, prelude: leftPrelude, envStruct: leftEnvStruct } = codegenExpr(ast.left, envId);
      if (leftPrelude) prelude += leftPrelude;
      if (leftEnvStruct) envStruct += leftEnvStruct;

      const { expr: rightExpr, prelude: rightPrelude, envStruct: rightEnvStruct } = codegenExpr(ast.right, envId);
      if (rightPrelude) prelude += (prelude.length === 0 ? "" : "\n") + rightPrelude;
      if (rightEnvStruct) envStruct += (envStruct.length === 0 ? "" : "\n\n") + rightEnvStruct;

      return {
        expr: `(${leftExpr} ${ast.operator} ${rightExpr})`,
        prelude: (prelude.length !== 0) ? prelude : undefined,
        envStruct: (envStruct.length !== 0) ? envStruct : undefined
      };
    }
    case "unary": {
      const { expr: operandExpr, prelude, envStruct } = codegenExpr(ast.operand, envId);
      return { expr: `${ast.operator}${operandExpr}`, prelude, envStruct };
    }
    case "call": {
      const { expr: calleeExpr, prelude: calleePrelude, envStruct: calleeEnvStruct } = codegenExpr(ast.callee, envId);
      const procInfo = procInfoMap.get(calleeExpr);
      if (!procInfo) {
        if (calleeExpr === "ajisai_println_i32" || calleeExpr === "ajisai_println_bool") {
          const { expr: argExpr, prelude: argPrelude, envStruct: argEnvStruct } = codegenExpr(ast.args[0], envId);
          return {
            expr: "",
            prelude: ((calleePrelude ? calleePrelude + "\n" : "") + (argPrelude ? argPrelude : "")) + `\n  ${calleeExpr}(${argExpr});`,
            envStruct: ((calleeEnvStruct ? calleeEnvStruct + "\n\n" : "") + (argEnvStruct ? argEnvStruct : "")) || undefined
          };
        }
        throw new Error(`there is not info about proc '${calleeExpr}'`);
      }
      let prelude = `  struct Env${procInfo.envId} env${procInfo.envId} = `;
      if (envId === 0) {
        prelude += "{};";
      } else {
        prelude += `{ .header = { .parent = (EnvHeader *)&env${envId} } };`
      }
      let envStruct = "";
      for (let i = 0; i < ast.args.length; i++) {
        const { expr: argExpr, prelude: argPrelude, envStruct: argEnvStruct } = codegenExpr(ast.args[i], envId);
        if (argPrelude) prelude += "\n" + argPrelude;
        prelude += `\n  env${procInfo.envId}.arg_${procInfo.argInfos[i].argName} = ${argExpr};`
        if (envStruct.length === 0) {
          if (argEnvStruct) envStruct += argEnvStruct;
        } else {
          if (argEnvStruct) envStruct += "\n\n" + argEnvStruct;
        }
      }
      prelude += `\n  ${calleeExpr}(&env${procInfo.envId});`;
      if (procInfo.returnCType === "void") {
        return { expr: "", prelude, envStruct: envStruct || undefined };
      } else {
        return { expr: `env${procInfo.envId}.result`, prelude, envStruct: envStruct || undefined };
      }
    }
    case "integer":
      return { expr: `${ast.value}` };
    case "bool":
      return { expr: ast.value ? "true" : "false" };
    case "unit":
      return { expr: "" };
    case "variable": {
      let parentAccess = "";
      if (ast.level > 0) {
        parentAccess += "parent";
        for (let i = 0; i < ast.level-1; i++) {
          parentAccess += "->parent";
        }
      }
      if (ast.level === 0) {
        return { expr: `env${ast.fromEnv}${procEnvIds.includes(ast.fromEnv) ? "->" : "."}arg_${ast.name}` };
      } else if (ast.level > 0) {
        return { expr: `((struct Env${ast.toEnv} *)(((EnvHeader *)&env${ast.fromEnv})->${parentAccess}))->arg_${ast.name}` };
      } else {
        // TODO: level === -1 の時、関数以外も対応する
        const procName = getProcName(ast.name);
        return { expr: procName };
      }
    }
    case "let":
      return codegenLet(ast, envId);
    case "if":
      return codegenIf(ast, envId);
    default:
      throw new Error(`invalid term node: ${ast.nodeType}`);
  }
};

const codegenLet = (ast: AstLetNode, parentEnvId: number): { expr: string, prelude: string, envStruct: string } => {
  let subEnvStruct = "";
  let envStruct = `struct Env${ast.envId} {\n  EnvHeader header;`;
  let prelude = `  struct Env${ast.envId} env${ast.envId} = `;
  if (parentEnvId === 0) {
    prelude += "{};";
  } else {
    prelude += `{ .header = { .parent = (EnvHeader *)&env${parentEnvId} }};`;
  }

  for (const { name, ty, value } of ast.declares) {
    if (ty?.tyKind === "builtin") {
      if (ty.name === "i32") {
        envStruct += `\n  int32_t arg_${name};`;
      } else if (ty.name === "bool") {
        envStruct += `\n  bool arg_${name};`;
      }
    }
    const { expr, prelude: valuePrelude, envStruct: valueEnvStruct } = codegenExpr(value, ast.envId);
    if (valueEnvStruct) subEnvStruct += (subEnvStruct.length === 0 ? "" : "\n\n") + valueEnvStruct;
    if (valuePrelude) prelude += "\n" + valuePrelude;
    prelude += `\n  env${ast.envId}.arg_${name} = ${expr};`;
  }

  envStruct += "\n};";

  const { expr, prelude: bodyPrelude, envStruct: bodyEnvStruct } = codegenExpr(ast.body, ast.envId);
  if (bodyPrelude) prelude += "\n" + bodyPrelude;
  if (bodyEnvStruct) subEnvStruct += (subEnvStruct.length === 0 ? "" : "\n\n") + bodyEnvStruct;

  if (subEnvStruct.length !== 0) {
    envStruct = subEnvStruct + "\n\n" + envStruct;
  }

  return { expr, prelude, envStruct };
};

const codegenIf = (ast: AstIfNode, envId: number): { expr: string, prelude: string, envStruct: string } => {
  // TODO: １行で終わらない式は戻り値を格納する一時変数が必要だが、
  //       GC時にトレースできるようにしなければならない
  //       現在いるスコープのenvがその場所を触れるようにしなければならない
  const ty = ast.ty!;
  let tyStr;
  if (ty.tyKind === "builtin") {
    if (ty.name === "i32") {
      tyStr = "int32_t";
    } else if (ty.name === "bool") {
      tyStr = "bool";
    }
  } else {
    throw new Error("unimplemented for other if return type");
  }

  let resultVar;
  if (ty.tyKind === "builtin" && ty.name !== "()") {
    resultVar = `tmp${tmpVarId++}`;
  }
  let prelude = resultVar ? `  ${tyStr} ${resultVar};` : "";
  let envStruct = "";

  const { expr: condExpr, prelude: condPrelude, envStruct: condEnvStruct } = codegenExpr(ast.cond, envId);
  if (condPrelude) prelude += "\n" + condPrelude;
  if (condEnvStruct) envStruct += condEnvStruct;
  prelude += `\n  if (${condExpr}) {`;

  const { expr: thenExpr, prelude: thenPrelude, envStruct: thenEnvStruct } = codegenExpr(ast.then, envId);
  if (thenPrelude) prelude += "\n" + thenPrelude;
  if (thenEnvStruct) envStruct += (envStruct.length === 0 ? "" : "\n\n") + thenEnvStruct;
  if (resultVar) {
    prelude += `\n  ${resultVar} = ${thenExpr};`;
  }

  prelude += "\n  } else {";

  const { expr: elseExpr, prelude: elsePrelude, envStruct: elseEnvStruct } = codegenExpr(ast.else, envId);
  if (elsePrelude) prelude += "\n" + elsePrelude;
  if (elseEnvStruct) envStruct += (envStruct.length === 0 ? "" : "\n\n") + elseEnvStruct;
  if (resultVar) {
    prelude += `\n  ${resultVar} = ${elseExpr};`;
  }

  prelude += "\n  }";

  return { expr: resultVar ? resultVar : "", prelude, envStruct };
};
