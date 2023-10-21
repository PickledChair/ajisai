import { ACEntryInst, ACIfElseInst, ACModuleInst, ACProcBodyInst, ACProcDeclInst, ACProcDefInst, ACPushValInst } from "./acir.ts";
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

    for (const procDecl of module.procDecls) {
      await printProtoType(writer, encoder, procDecl);
    }

    for (const procDef of module.procDefs) {
      await writer.write(encoder.encode("\n"));
      await printProcDef(writer, encoder, procDef);
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

const printProtoType = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, procDecl: ACProcDeclInst) => {
  let line = `${toCType(procDecl.resultType)} userdef_${procDecl.procName}(ProcFrame *parent_frame`;
  for (const [argName, argTy] of procDecl.args) {
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
  await writer.write(encoder.encode("  ProcFrame *parent_frame = &(ProcFrame){ .parent = NULL, .mem_manager = &mem_manager };\n"));

  for (const inst of entry.body) {
    await printProcBodyInst(writer, encoder, inst);
  }

  await writer.write(encoder.encode("  ajisai_mem_manager_deinit(&mem_manager);\n"));
  await writer.write(encoder.encode("}\n"));
};

const printProcDef = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, procDef: ACProcDefInst) => {
  let headLine = `${toCType(procDef.resultType)} userdef_${procDef.procName}(ProcFrame *parent_frame`;
  for (const [argName, argTy] of procDef.args) {
    headLine += `, ${toCType(argTy)} env${procDef.envId}_var_${argName}`;
  }
  headLine += ") {\n";
  await writer.write(encoder.encode(headLine));

  for (const inst of procDef.body) {
    await printProcBodyInst(writer, encoder, inst);
  }

  await writer.write(encoder.encode("}\n"));
};

const printProcBodyInst = async (writer: WritableStreamDefaultWriter, encoder: TextEncoder, inst: ACProcBodyInst) => {
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
    case "proc_frame.init":
      line = `  ProcFrame proc_frame = { .parent = parent_frame, .mem_manager = parent_frame->mem_manager, .root_table_size = ${inst.rootTableSize}`;
      if (inst.rootTableSize > 0) {
        line += ", .root_table = root_table";
      }
      line += " };\n";
      break;
    case "proc.return":
      line = `  return ${makePushValLiteral(inst.value)};\n`;
      break;
    case "env.defvar":
      line = `  ${toCType(inst.ty)} env${inst.envId}_var_${inst.varName} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "proc_frame.deftmp":
      line = `  ${toCType(inst.ty)} env${inst.envId}_tmp${inst.idx} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "proc_frame.deftmp_noval":
      line = `  ${toCType(inst.ty)} env${inst.envId}_tmp${inst.idx};\n`;
      break;
    case "proc_frame.store_tmp":
      line = `  env${inst.envId}_tmp${inst.idx} = ${makePushValLiteral(inst.value)};\n`;
      break;
    case "ifelse":
      await printIfElse(writer, encoder, inst);
      return;
    case "builtin.call":
    case "builtin.call_with_frame":
    case "proc.call":
      line = `  ${makePushValLiteral(inst)};\n`;
      break;
    case "str.make_static":
      // TODO: collect_root_func を設定
      line = `  static AjisaiString static_str${inst.id} = { .obj_header = { .tag = AJISAI_OBJ_STR }, .len = ${inst.len}, .value = ${inst.value} };\n  static_str${inst.id}.obj_header.type_info = ajisai_str_type_info();\n`;
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
      return `userdef_${inst.varName}`;
    case "env.load":
      return `env${inst.envId}_var_${inst.varName}`;
    case "proc_frame.load_tmp":
      return `env${inst.envId}_tmp${inst.idx}`;
    case "builtin.call": {
      const callee = makePushValLiteral(inst.callee);
      const args = inst.args.map(arg => makePushValLiteral(arg));
      return `${callee}(${args.join(", ")})`;
    }
    case "builtin.call_with_frame":
    case "proc.call": {
      const callee = makePushValLiteral(inst.callee);
      const args = inst.args.map(arg => makePushValLiteral(arg));
      return `${callee}(&proc_frame${args.length === 0 ? "" : ", " + args.join(", ")})`;
    }
    case "i32.const":
    case "bool.const":
      return `${inst.value}`;
    case "str.const":
      return `&static_str${inst.id}`;
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
    await printProcBodyInst(writer, encoder, thenInst);
  }

  await writer.write(encoder.encode("  } else {\n"));

  for (const elseInst of inst.else) {
    await printProcBodyInst(writer, encoder, elseInst);
  }

  await writer.write(encoder.encode("  }\n"));
};
