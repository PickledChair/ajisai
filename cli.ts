import { parse } from "https://deno.land/std@0.204.0/flags/mod.ts";
import { CodeGenerator, Lexer, Parser, SemanticAnalyzer, printCSrc } from "./mod.ts";

if (import.meta.main) {
  const { _: [fileName_,], ...otherOptions } = parse(Deno.args);

  if (fileName_) {
    const fileName = fileName_.toString();

    const source = await Deno.readTextFile(fileName);

    const lexer = new Lexer(source);
    const parser = new Parser(lexer, fileName);
    const ast = parser.parse();
    const semAnalyzer = new SemanticAnalyzer(ast);
    const analyzedAst = semAnalyzer.analyze();
    const codeGen = new CodeGenerator(analyzedAst, semAnalyzer.defTypeMap);
    const acir = codeGen.codegen();

    const optionCSourcePath_ = otherOptions["S"];
    if (optionCSourcePath_) {
      const optionCSourcePath = optionCSourcePath_.toString();
      await printCSrc(optionCSourcePath, acir);
      Deno.exit(0);
    }

    const distDir = "ajisai-out";
    try {
      const distDirStat = await Deno.stat(distDir);

      if (!distDirStat.isDirectory) {
        console.error(`"ajisai-out" must be directory`);
        Deno.exit(1);
      }
    } catch {
      await Deno.mkdir(distDir);
    }

    const mainCSourcePath = `${distDir}/main.c`;
    await printCSrc(mainCSourcePath, acir);
    console.log(`success: writing to ${mainCSourcePath}`);

    const wnos = ["-Wno-parentheses-equality"];
    const cwd = Deno.cwd();
    const runtimeDir = cwd + "/runtime";

    let ccArgs = [
      ...wnos,
      mainCSourcePath,
      runtimeDir + "/ajisai_runtime.c", "-I" + runtimeDir
    ];

    const outputFileName = otherOptions["o"];
    if (outputFileName) {
      ccArgs = ["-o", outputFileName].concat(ccArgs);
    }
    if (otherOptions["mem_manager_dbg_output"]) {
      ccArgs.push("-DAJISAI_MEMORY_MANAGER_DEBUG_OUTPUT");
    }

    const command = new Deno.Command("cc", {
      args: ccArgs,
    });
    const { code, stdout, stderr } = command.outputSync();

    const stdoutStr = new TextDecoder().decode(stdout);
    if (stdoutStr.length > 0) console.log(stdoutStr);
    const stderrStr = new TextDecoder().decode(stderr);
    if (stderrStr.length > 0) console.error(stderrStr);

    if (code !== 0) {
      Deno.exit(code);
    }
    console.log("success: compiling");
  }
}
