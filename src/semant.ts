import { VarEnv } from "./env.ts";
import { Type, PrimitiveType, tyEqual, mayBeHeapObj, FuncType } from "./type.ts";
import {
  AstBinaryNode,
  AstLetNode,
  AstDeclareNode,
  AstUnaryNode,
  AstIfNode,
  AstExprNode,
  AstDefNode,
  AstModuleNode,
  AstFuncNode,
  AstCallNode,
  AstExprSeqNode,
  AstModuleDeclareNode,
  AstPathNode,
  AstGlobalVarNode
} from "./ast.ts";

export type DefTypeMap = Map<string, Type>;

export const builtinDefTypeMap = (): DefTypeMap => {
  const defTypeMap = new Map();
  defTypeMap.set(
    "print_i32",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_i32",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "print_bool",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "bool" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_bool",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "bool" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "print_str",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_str",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "flush",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "str_concat",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "str_slice",
    {
      tyKind: "func",
      funcKind: "builtin",
      // TODO: 範囲指定のための数値型は符号なし整数にする
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "i32" }, { tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "str_equal",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "bool" }
    }
  );
  defTypeMap.set(
    "str_repeat",
    {
      tyKind: "func",
      funcKind: "builtin",
      // TODO: 反復回数指定のための数値型は符号なし整数にする
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "str_len",
    {
      tyKind: "func",
      funcKind: "builtin",
      // TODO: 戻り値の型は符号なし整数にする
      argTypes: [{ tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "i32" }
    }
  );

  defTypeMap.set(
    "gc_start",
    {
      tyKind: "func",
      funcKind: "builtin",
      argTypes: [],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  return defTypeMap;
};

const makeDefTypeMap = (module: AstModuleNode): DefTypeMap => {
  const defTypeMap = new Map();
  for (const def of module.defs) {
    if (def.declare.nodeType === "moduleDeclare") continue;
    const { declare: { name, ty } } = def;
    if (ty) {
      defTypeMap.set(name, ty);
    } else {
      throw new Error(`type of definition '${name}' is unknown`);
    }
  }
  return defTypeMap;
};

class ModuleRenamer {
  #prevModIdxs: Map<string, number> = new Map();

  renameModule(name: string): string {
    const idx = this.#prevModIdxs.get(name);
    if (idx) {
      const nextIdx = idx + 1;
      this.#prevModIdxs.set(name, nextIdx);
      return `${name}{nextIdx}`;
    } else {
      this.#prevModIdxs.set(name, 0);
      return `${name}0`;
    }
  }
}

const getType = (name: string, defTypeMap: DefTypeMap, builtins?: DefTypeMap): Type | undefined => {
  const ty = defTypeMap.get(name);
  if (ty) {
    return ty;
  } else {
    return builtins?.get(name);
  }
};

export class SemanticAnalyzer {
  #builtins: DefTypeMap;
  #module: AstModuleNode;
  #modRenamer: ModuleRenamer;
  modName: { orig: string, renamed: string };
  #additional_defs: AstDefNode[] = [];
  clsId: number;
  defTypeMap: DefTypeMap;
  subModAnalyzers: Map<string, SemanticAnalyzer> = new Map();

  constructor(
    modDeclare: AstModuleDeclareNode,
    builtinDefTypeMap: DefTypeMap,
    modRenamer?: ModuleRenamer,
    startClosureId?: number
  ) {
    this.#builtins = builtinDefTypeMap;
    this.#module = modDeclare.mod;
    if (modRenamer) {
      this.#modRenamer = modRenamer;
    } else {
      this.#modRenamer = new ModuleRenamer();
    }
    if (startClosureId) {
      this.clsId = startClosureId;
    } else {
      this.clsId = 0;
    }
    this.modName = {
      orig: modDeclare.name,
      renamed: this.#modRenamer.renameModule(modDeclare.name)
    };
    this.defTypeMap = makeDefTypeMap(modDeclare.mod);
  }

  analyze(): AstModuleNode {
    const defs = this.#module.defs.map(def => this.analyzeDef(def));
    for (const def of this.#additional_defs) {
      if (def.declare.nodeType === "moduleDeclare") continue;
      this.defTypeMap.set(def.declare.name, def.declare.ty!);
      defs.push(def);
    }
    return { nodeType: "module", defs };
  }

  private analyzeDef(ast: AstDefNode): AstDefNode {
    if (ast.declare.nodeType === "declare") {
      // FIXME: モジュールレベルの変数の置き場は defTypeMap である
      //        VarEnv("module") がただの番兵なのはミスリードに思える
      const [exprNode, exprTy] = this.analyzeExpr(ast.declare.value, new VarEnv("module"));
      if (ast.declare.ty) {
        if (tyEqual(ast.declare.ty, exprTy)) {
          return {
            nodeType: "def",
            declare: {
              nodeType: "declare",
              name: ast.declare.name,
              ty: ast.declare.ty,
              value: exprNode,
              modName: this.modName.renamed
            }
          };
        } else {
          throw new Error("invalid expr type");
        }
      } else {
        // moduleのトップレベルの定義は型注釈を必須にする
        throw new Error("definition without type signature");
      }
    }
    if (ast.declare.nodeType === "moduleDeclare") {
      const subModAnalyzer = new SemanticAnalyzer(ast.declare, this.#builtins, this.#modRenamer, this.clsId);
      const mod = subModAnalyzer.analyze();
      this.clsId = subModAnalyzer.clsId;
      this.subModAnalyzers.set(subModAnalyzer.modName.orig, subModAnalyzer);
      return {
        nodeType: "def",
        declare: {
          nodeType: "moduleDeclare",
          name: subModAnalyzer.modName.renamed,
          mod
        }
      };
    }
    throw new Error("not yet implemented");
  }

  private analyzeExpr(ast: AstExprNode, varEnv: VarEnv): [AstExprNode, Type] {
    let astTy;

    if (ast.nodeType === "func") {
      const [node, ty] = this.analyzeFunc(ast, new VarEnv("func", varEnv));
      if (varEnv.envKind !== "module") {
        node.rootIdx = varEnv.freshRootId();
      }
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "call") {
      const [node, ty] = this.analyzeCall(ast, varEnv);
      if (mayBeHeapObj(ty)) {
        node.rootIdx = varEnv.freshRootId();
      }
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "let") {
      const [node, ty] = this.analyzeLet(ast, new VarEnv("let", varEnv));
      if (mayBeHeapObj(ty)) {
        node.rootIdx = varEnv.freshRootId();
      }
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "if") {
      const [node, ty] = this.analyzeIf(ast, varEnv);
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "binary") {
      const [node, ty] = this.analyzeBinary(ast, varEnv);
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "unary") {
      const [node, ty] = this.analyzeUnary(ast, varEnv);
      ast = node;
      astTy = ty;
    } else if (ast.nodeType === "localVar") {
      const result = varEnv.getVarTy(ast.name);
      if (result) {
        const { ty, envKind, envId } = result;
        if (envKind === "module") {
          throw new Error("unreachable");
        } else {
          if (envId === -1) throw new Error("invalid envId: -1");
          ast = { nodeType: "localVar", name: ast.name, fromEnv: varEnv.envId, toEnv: envId, ty };
        }
        astTy = ty;
      } else {
        const ty = getType(ast.name, this.defTypeMap, this.#builtins);
        if (ty) {
          return [
            // TODO: modName も指定する
            { nodeType: "globalVar", name: ast.name, ty, modName: this.modName.renamed },
            ty
          ];
        }
        throw new Error(`variable not found: ${ast.name}`);
      }
    } else if (ast.nodeType === "path") {
      let modName = ast.sup;
      let mod: SemanticAnalyzer | undefined = this.subModAnalyzers.get(modName);
      let node: AstPathNode | AstGlobalVarNode = ast.sub;
      while (node.nodeType === "path") {
        if (mod == null) throw new Error(`invalid module name: ${modName}`);
        modName = node.sup;
        mod = mod.subModAnalyzers.get(modName);
        node = node.sub;
      }
      if (mod == null) throw new Error(`invalid module name: ${modName}`);
      const ty = mod.defTypeMap.get(node.name);
      if (ty == null) throw new Error(`variable '${node.name}' not found in module '${modName}'`);
      astTy = ty;
      node.ty = ty;
      node.modName = mod.modName.renamed;
      ast = node;
    } else if (ast.nodeType === "integer") {
      astTy = { tyKind: "primitive", name: "i32" } as PrimitiveType;
    } else if (ast.nodeType === "bool") {
      astTy = { tyKind: "primitive", name: "bool" } as PrimitiveType;
    } else if (ast.nodeType === "string") {
      // 文字列リテラルのダブルクォートはカウントしないように注意する
      let idx = 1;
      let len = 0;
      while (idx < ast.value.length - 1) {
        // TODO: エスケープシーケンスについて考慮すべきことを洗い出す
        if (ast.value.charAt(idx) === "\\")
          idx++;
        idx++;
        len++;
      }
      ast.len = len;
      astTy = { tyKind: "primitive", name: "str" } as PrimitiveType;
    } else if (ast.nodeType === "unit") {
      astTy = { tyKind: "primitive", name: "()" } as PrimitiveType;
    } else {
      throw new Error("unreachable");
    }

    return [ast, astTy];
  }

  private analyzeExprSeq(ast: AstExprSeqNode, varEnv: VarEnv): [AstExprSeqNode, Type] {
    const exprs: AstExprNode[] = [];
    let exprSeqType: Type = { tyKind: "dummy" };
    for (const expr of ast.exprs) {
      const [ analyzedExpr, ty ] = this.analyzeExpr(expr, varEnv);
      exprs.push(analyzedExpr);
      exprSeqType = ty;
    }
    return [{ nodeType: "exprSeq", exprs, ty: exprSeqType }, exprSeqType];
  }

  private freshClsId(): number {
    return this.clsId++;
  }

  private analyzeFunc(ast: AstFuncNode, varEnv: VarEnv): [AstFuncNode, FuncType] {
    for (const { name, ty } of ast.args) {
      if (ty) {
        varEnv.setNewVarTy(name, ty);
      } else {
        // TODO: ローカルに関数を定義できるようになったら、型シグネチャを必要としないので、簡易的な型推論が必要になる
        //       引数の型が指定されていない場合、dummyを設定しておく。ここではもうこれで良い
        //       あとで関数のbodyの解析中に決定させる必要がある
        varEnv.setNewVarTy(name, { tyKind: "dummy" });
      }
    }

    const [bodyAst, bodyType] = this.analyzeExprSeq(ast.body, varEnv);

    // ここではすでに引数の型が決定しているはず
    const argTypes = ast.args.map(({ name, ty }) => {
      if (ty) {
        return ty;
      } else {
        const { ty: resolvedTy, envKind } = varEnv.getVarTy(name)!;
        // FIXME: envKind だけでは現在の関数の引数であるかどうかがわからない
        //        外側の関数からキャプチャされた変数である可能性がある
        if (envKind !== "func") {
          throw new Error("not func arg");
        }
        return resolvedTy;
      }
    });

    const funcTy: Type = {
      tyKind: "func",
      funcKind: varEnv.parent_!.envKind === "module" ? "userdef" : "closure",
      argTypes,
      bodyType
    };

    const funcAst: AstFuncNode = {
      nodeType: "func",
      args: ast.args,
      body: bodyAst,
      envId: varEnv.envId,
      bodyTy: bodyType,
      rootTableSize: varEnv.rootTableSize,
      closureId: varEnv.parent_!.envKind === "module" ? undefined : this.freshClsId(),
      ty: funcTy
    };

    if (funcTy.funcKind === "closure") {
      this.#additional_defs.push({
        nodeType: "def",
        declare: {
          nodeType: "declare",
          name: `${funcAst.closureId!}`,
          ty: funcTy,
          value: funcAst
        }
      });
    }

    return [funcAst, funcTy];
  }

  private analyzeCall(ast: AstCallNode, varEnv: VarEnv): [AstCallNode, Type] {
    if (ast.callee.nodeType === "func") {
      const [funcAst, funcTy] = this.analyzeExpr(ast.callee, varEnv);
      if (funcTy.tyKind !== "func") throw Error("unreachable");
      const args = [];
      for (let i = 0; i < funcTy.argTypes.length; i++) {
        const [argAst, argTy] = this.analyzeExpr(ast.args[i], varEnv);
        if (!tyEqual(funcTy.argTypes[i], argTy)) {
          throw new Error("invalid arg type");
        }
        args.push(argAst);
      }
      return [{ nodeType: "call", callee: funcAst, args, ty: funcTy.bodyType, calleeTy: funcTy }, funcTy.bodyType];
    }

    const [varAst, varTy] = this.analyzeExpr(ast.callee, varEnv);

    if (varTy.tyKind !== "func") {
      throw new Error("invalid callee type");
    }

    if (ast.args.length !== varTy.argTypes.length) {
      throw new Error(`invalid number of args: expected ${varTy.argTypes.length}, but got ${ast.args.length}`);
    }

    const args = [];
    for (let i = 0; i < varTy.argTypes.length; i++) {
      const [argAst, argTy] = this.analyzeExpr(ast.args[i], varEnv);
      if (!tyEqual(varTy.argTypes[i], argTy)) {
        throw new Error("invalid arg type");
      }
      args.push(argAst);
    }

    return [{ nodeType: "call", callee: varAst, args, ty: varTy.bodyType, calleeTy: varTy }, varTy.bodyType];
  }

  private analyzeLet(ast: AstLetNode, varEnv: VarEnv): [AstLetNode, Type] {
    const newDeclares: AstDeclareNode[] = [];
    for (const declare of ast.declares) {
      // TODO: 重複したローカル変数名でエラーを出す
      newDeclares.push(this.analyzeDeclare(declare, varEnv));
    }

    const [bodyAst, bodyTy] = this.analyzeExprSeq(ast.body, varEnv);

    return [{ nodeType: "let", declares: newDeclares, body: bodyAst, bodyTy, envId: varEnv.envId, rootIndices: varEnv.rootIndices }, bodyTy];
  }

  // NOTE: analyzeDeclare はローカル環境の変数束縛に対してのみ使われている
  private analyzeDeclare(ast: AstDeclareNode, varEnv: VarEnv): AstDeclareNode {
    const { name, ty, value } = ast;
    const [ exprAst, exprTy_ ] = this.analyzeExpr(value, varEnv);

    // TODO: integerリテラルをi32と対応させているが、今後u32等の他の型も登場させると対応関係が崩れる
    //       リテラルと型の対応が一対一でなくなった時に実装を変える必要がある
    let exprTy = exprTy_;
    // NOTE: この関数はローカル環境の変数束縛のみが対象なので、
    //       モジュールレベルの関数を束縛したらクロージャに変換しなければならない
    if (exprTy.tyKind === "func" && exprTy.funcKind !== "closure") {
      exprTy = { ...exprTy, funcKind: "closure" };
    }
    if (ty) {
      if (!tyEqual(ty, exprTy)) {
        throw new Error("mismatch type in declaration");
      }
    }
    varEnv.setNewVarTy(name, exprTy);

    return { nodeType: "declare", name, ty: exprTy, value: exprAst };
  }

  private analyzeIf(ast: AstIfNode, varEnv: VarEnv): [AstIfNode, Type] {
    const [ cond, condTy ] = this.analyzeExpr(ast.cond, varEnv);
    if (!(condTy.tyKind === "primitive" && condTy.name === "bool")) {
      throw new Error("condition expression of 'if' must be bool type");
    }

    const [ then, thenTy ] = this.analyzeExprSeq(ast.then, varEnv);
    const [ else_, elseTy ] = this.analyzeExprSeq(ast.else, varEnv);

    if (!tyEqual(thenTy, elseTy)) {
      throw new Error("mismatch type between then clause and else clause in if expression");
    }

    return [{ nodeType: "if", cond, then, else: else_, ty: thenTy }, thenTy];
  }

  private analyzeBinary(ast: AstBinaryNode, varEnv: VarEnv): [AstBinaryNode, Type] {
    const [leftAst, leftTy] = this.analyzeExpr(ast.left, varEnv);
    const [rightAst, rightTy] = this.analyzeExpr(ast.right, varEnv);

    if (!tyEqual(leftTy, rightTy)) {
      throw new Error(`invalid binary expression`);
    }

    ast.left = leftAst;
    ast.right = rightAst;

    // TODO: bool型とi32型の時、また型が決まっていないローカル変数の時の条件分岐を考える
    //       ローカルに無名関数を定義できるようになったらよく考える必要がある
    if (leftTy.tyKind === "primitive" && rightTy.tyKind === "primitive") {
      const ty: Type = ["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(ast.operator) ? { tyKind: "primitive", name: "bool" } : leftTy;
      ast.ty = ty;
      return [ast, ty];
    }

    ast.ty = leftTy;
    return [ast, leftTy];
  }

  private analyzeUnary(ast: AstUnaryNode, varEnv: VarEnv): [AstUnaryNode, Type] {
    const [operandAst, operandTy] = this.analyzeExpr(ast.operand, varEnv);
    ast.operand = operandAst;
    if (operandTy.tyKind === "primitive") {
      if (ast.operator === "!" && operandTy.name !== "bool") {
        throw new Error("'!' operator with non-boolean operand");
      }
      if (ast.operator === "-" && operandTy.name !== "i32") {
        throw new Error("'-' operator with non-integer operand");
      }
      ast.ty = operandTy;
      return [ast, operandTy];
    }
    if (operandTy.tyKind === "dummy"
        && (operandAst.nodeType === "localVar"
           || operandAst.nodeType === "globalVar")) {
      let ty: Type | undefined;
      if (ast.operator === "!") {
        ty = { tyKind: "primitive", name: "bool" };
      }
      if (ast.operator === "-") {
        ty = { tyKind: "primitive", name: "i32" };
      }
      if (ty) {
        // TODO: varEnv が level を扱わないように変更する
        varEnv.setVarTy(
          operandAst.name,
          ty,
        );
        ast.ty = ty;
        return [ast, ty];
      } else {
        throw new Error("unreachable");
      }
    }
    throw new Error("invalid unary node type");
  }
}
