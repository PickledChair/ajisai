import { parse } from "https://deno.land/std@0.194.0/flags/mod.ts";
import { Lexer, Parser, semantAnalyze, codegen } from "./mod.ts";

if (import.meta.main) {
  const { _: [fileName,], ...otherOptions } = parse(Deno.args);

  if (fileName) {
    if (typeof fileName == "number") {
      console.log(`Invalid filename: ${fileName}`);
    } else {
      const source = await Deno.readTextFile(fileName);

      const lexer = new Lexer(source);
      const parser = new Parser(lexer);
      const ast = parser.parse();
      semantAnalyze(ast);
      const analyzedAst = semantAnalyze(ast);
      const cSrc = codegen(analyzedAst);

      const optionCSourcePath = otherOptions["S"];
      if (optionCSourcePath) {
        await Deno.writeTextFile(optionCSourcePath, cSrc);
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
      await Deno.writeTextFile(mainCSourcePath, cSrc);
      console.log(`success: writing to ${mainCSourcePath}`);

      const wnos = ["-Wno-parentheses-equality"];

      const outputFileName = otherOptions["o"];
      let ccArgs;
      if (outputFileName) {
        ccArgs = ["-o", outputFileName, ...wnos, mainCSourcePath];
      } else {
        ccArgs = [...wnos, mainCSourcePath];
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
}
