import { ACEntryInst, ACIfElseInst, ACModuleInst, ACFuncBodyInst, ACDeclInst, ACDefInst, ACPushValInst } from "./acir.ts";
import { toCType } from "./type.ts";

const defaultFileHeader = "#include <ajisai_runtime.h>\n\n";

const cMain = `int main(void) {
  ajisai_main();
  return 0;
}
`;

export const printCSrc = async (filePath: string, module: ACModuleInst) => {
  const file = await Deno.open(filePath, { write: true, create: true, truncate: true });
  const writer = file.writable.getWriter();

  try {
    const encoder = new TextEncoder();

    await writer.write(encoder.encode(defaultFileHeader));

    for (const funcDecl of module.funcDecls) {
      await printProtoType(writer, encoder, funcDecl);
    }

    for (const funcDef of module.funcDefs) {
      await writer.write(encoder.encode("\n"));
      await printFuncDef(writer, encoder, funcDef);
    }

    if (module.entry) {
      await writer.write(encoder.encode("\n"));
      await printEntry(writer, encoder, module.entry);

      await writer.write(encoder.encode("\n"));
      await writer.write(encoder.encode(cMain));
    }
  } finally {
    file.close();
  }
};

const printProtoType = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, decl: ACDeclInst) => {
  let line = `${toCType(decl.resultType)} ${decl.inst === "func.decl" ? `userdef__${decl.modName}_` : "closure"}_${decl.funcName}(AjisaiFuncFrame *parent_frame`;

  for (const [argName, argTy] of decl.args) {
    line += `, ${toCType(argTy)} ${argName}`;
  }

  line += ");\n";

  await writer.write(encoder.encode(line));
};

const printEntry = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, entry: ACEntryInst) => {
  await writer.write(encoder.encode("void ajisai_main(void) {\n"));
  await writer.write(encoder.encode("  AjisaiMemManager mem_manager;\n"));
  // TODO: メモリ確保に失敗した時に終了する処理を入れる
  await writer.write(encoder.encode("  ajisai_mem_manager_init(&mem_manager);\n"));
  await writer.write(encoder.encode("  AjisaiFuncFrame *parent_frame = &(AjisaiFuncFrame){ .parent = NULL, .mem_manager = &mem_manager };\n"));

  for (const inst of entry.body) {
    await printFuncBodyInst(writer, encoder, inst);
  }

  await writer.write(encoder.encode("  ajisai_mem_manager_deinit(&mem_manager);\n"));
  await writer.write(encoder.encode("}\n"));
};

const printFuncDef = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, def: ACDefInst) => {
  let headLine = `${toCType(def.resultType)} ${def.inst === "func.def" ? `userdef__${def.modName}_` : "closure"}_${def.funcName}(AjisaiFuncFrame *parent_frame`;
  for (const [argName, argTy] of def.args) {
    headLine += `, ${toCType(argTy)} env${def.envId}_var_${argName}`;
  }
  headLine += ") {\n";
  await writer.write(encoder.encode(headLine));

  for (const inst of def.body) {
    await printFuncBodyInst(writer, encoder, inst);
  }

  await writer.write(encoder.encode("}\n"));
};

const printFuncBodyInst = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, inst: ACFuncBodyInst) => {
  let line = "";

  switch (inst.inst) {
    case "root_table.init":
      line = `  AjisaiObject *root_table[${inst.size}] = {};\n`;
      break;
    case "root_table.reg":
      line = `  root_table[${inst.rootTableIdx}] = (AjisaiObject *)env${inst.envId}_tmp${inst.tmpVarIdx};\n`;
      break;
    case "root_table.unreg":
      line = `  root_table[${inst.idx}] = NULL;\n`;
      break;
    case "func_frame.init":
      line = `  AjisaiFuncFrame func_frame = { .parent = parent_frame, .mem_manager = parent_frame->mem_manager, .root_table_size = ${inst.rootTableSize}`;
      if (inst.rootTableSize > 0) {
        line += ", .root_table = root_table";
      }
      line += " };\n";
      break;
    case "func.return":
      line = `  return ${makePushValLiteral(inst.value)};\n`;
      break;
    case "env.defvar":
      line = `  ${toCType(inst.ty)} env${inst.envId}_var_${inst.varName} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "func_frame.deftmp":
      line = `  ${toCType(inst.ty)} env${inst.envId}_tmp${inst.idx} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "func_frame.deftmp_noval":
      line = `  ${toCType(inst.ty)} env${inst.envId}_tmp${inst.idx};\n`;
      break;
    case "func_frame.store_tmp":
      line = `  env${inst.envId}_tmp${inst.idx} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "ifelse":
      await printIfElse(writer, encoder, inst);
      return;
    case "func.call":
    case "closure.call":
      line = `  ${makePushValLiteral(inst)};\n`;
      break;
    case "str.make_static":
      line = `  static AjisaiString static_str${inst.id} = { .obj_header = { .tag = AJISAI_OBJ_STR }, .len = ${inst.len}, .value = ${inst.value} };\n  static_str${inst.id}.obj_header.type_info = ajisai_str_type_info();\n`;
      break;
    case "closure.make_static":
      line = `  static AjisaiClosure static_closure${inst.id} = { .obj_header = { .tag = AJISAI_OBJ_FUNC }, .func_ptr = ${inst.funcKind === "builtin" ? "ajisai" : `userdef__${inst.modName}_`}_${inst.name} };\n  static_closure${inst.id}.obj_header.type_info = ajisai_func_type_info();\n`;
      break;
    default:
      break;
  }

  await writer.write(encoder.encode(line));
};

const makePushValLiteral = (inst: ACPushValInst): string => {
  switch (inst.inst) {
    case "builtin.load":
      return `ajisai_${inst.varName}`;
    case "mod_defs.load":
      return `userdef__${inst.modName}__${inst.varName}`;
    case "closure.load":
      return `closure_obj_${inst.id}`;
    case "env.load":
      return `env${inst.envId}_var_${inst.varName}`;
    case "func_frame.load_tmp":
      return `env${inst.envId}_tmp${inst.idx}`;
    case "func.call": {
      const callee = makePushValLiteral(inst.callee);
      const args = inst.args.map(arg => makePushValLiteral(arg));
      return `${callee}(&func_frame${args.length === 0 ? "" : ", " + args.join(", ")})`;
    }
    case "closure.call": {
      const closure = makePushValLiteral(inst.callee);
      const args = inst.args.map(arg => makePushValLiteral(arg));
      const argCTypes = inst.argTypes.map(ty => toCType(ty));
      const bodyCType = toCType(inst.bodyType);
      return `((${bodyCType} (*)(AjisaiFuncFrame *${argCTypes.length === 0 ? "" : ", " + argCTypes.join(", ")}))${closure}->func_ptr)(&func_frame${args.length === 0 ? "" : ", " + args.join(", ")})`;
    }
    case "closure.make":
      return `ajisai_closure_new(&func_frame, closure_${inst.id}, NULL)`;
    case "i32.const":
    case "bool.const":
      return `${inst.value}`;
    case "str.const":
      return `&static_str${inst.id}`;
    case "closure.const":
      return `&static_closure${inst.id}`;
    case "i32.add":
      return `(${makePushValLiteral(inst.left)} + ${makePushValLiteral(inst.right)})`;
    case "i32.sub":
      return `(${makePushValLiteral(inst.left)} - ${makePushValLiteral(inst.right)})`;
    case "i32.mul":
      return `(${makePushValLiteral(inst.left)} * ${makePushValLiteral(inst.right)})`;
    case "i32.div":
      return `(${makePushValLiteral(inst.left)} / ${makePushValLiteral(inst.right)})`;
    case "i32.mod":
      return `(${makePushValLiteral(inst.left)} % ${makePushValLiteral(inst.right)})`;
    case "i32.neg":
      return `-${makePushValLiteral(inst.operand)}`;
    case "bool.not":
      return `!${makePushValLiteral(inst.operand)}`;
    case "i32.eq":
    case "bool.eq":
      return `(${makePushValLiteral(inst.left)} == ${makePushValLiteral(inst.right)})`;
    case "i32.ne":
    case "bool.ne":
      return `(${makePushValLiteral(inst.left)} != ${makePushValLiteral(inst.right)})`;
    case "i32.lt":
      return `(${makePushValLiteral(inst.left)} < ${makePushValLiteral(inst.right)})`;
    case "i32.le":
      return `(${makePushValLiteral(inst.left)} <= ${makePushValLiteral(inst.right)})`;
    case "i32.gt":
      return `(${makePushValLiteral(inst.left)} > ${makePushValLiteral(inst.right)})`;
    case "i32.ge":
      return `(${makePushValLiteral(inst.left)} >= ${makePushValLiteral(inst.right)})`;
    case "bool.and":
      return `(${makePushValLiteral(inst.left)} && ${makePushValLiteral(inst.right)})`;
    case "bool.or":
      return `(${makePushValLiteral(inst.left)} || ${makePushValLiteral(inst.right)})`;
  }
};

const printIfElse = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, inst: ACIfElseInst) => {
  await writer.write(encoder.encode(`  if (${makePushValLiteral(inst.cond)}) {\n`));

  for (const thenInst of inst.then) {
    await printFuncBodyInst(writer, encoder, thenInst);
  }

  await writer.write(encoder.encode("  } else {\n"));

  for (const elseInst of inst.else) {
    await printFuncBodyInst(writer, encoder, elseInst);
  }

  await writer.write(encoder.encode("  }\n"));
};
