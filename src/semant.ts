import { VarEnv } from "./env.ts";
import { Type, PrimitiveType, tyEqual, mayBeHeapObj, ProcType } from "./type.ts";
import { AstBinaryNode, AstLetNode, AstDeclareNode, AstUnaryNode, AstIfNode, AstExprNode, AstDefNode, AstModuleNode, AstProcNode, AstCallNode, AstExprSeqNode } from "./ast.ts";

export type DefTypeMap = Map<string, Type>;

const makeDefTypeMap = (module: AstModuleNode): DefTypeMap => {
  const defTypeMap = new Map();
  for (const { declare: { name, ty } } of module.defs) {
    if (ty) {
      defTypeMap.set(name, ty);
    } else {
      throw new Error(`type of definition '${name}' is unknown`);
    }
  }
  defTypeMap.set(
    "print_i32",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_i32",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "print_bool",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "bool" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_bool",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "bool" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "print_str",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "println_str",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "flush",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  defTypeMap.set(
    "str_concat",
    {
      tyKind: "proc",
      procKind: "builtinWithFrame",
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "str_slice",
    {
      tyKind: "proc",
      procKind: "builtinWithFrame",
      // TODO: 範囲指定のための数値型は符号なし整数にする
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "i32" }, { tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "str_equal",
    {
      tyKind: "proc",
      procKind: "builtin",
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "str" }],
      bodyType: { tyKind: "primitive", name: "bool" }
    }
  );
  defTypeMap.set(
    "str_repeat",
    {
      tyKind: "proc",
      procKind: "builtinWithFrame",
      // TODO: 反復回数指定のための数値型は符号なし整数にする
      argTypes: [{ tyKind: "primitive", name: "str" }, { tyKind: "primitive", name: "i32" }],
      bodyType: { tyKind: "primitive", name: "str" }
    }
  );
  defTypeMap.set(
    "gc_start",
    {
      tyKind: "proc",
      procKind: "builtinWithFrame",
      argTypes: [],
      bodyType: { tyKind: "primitive", name: "()" }
    }
  );
  return defTypeMap;
};

export class SemanticAnalyzer {
  #module: AstModuleNode;
  defTypeMap: DefTypeMap;

  constructor(module: AstModuleNode) {
    this.#module = module;
    this.defTypeMap = makeDefTypeMap(module);
  }

  analyze(): AstModuleNode {
    return {
      nodeType: "module",
      defs: this.#module.defs.map(def => this.analyzeDef(def))
    };
  }

  private analyzeDef(ast: AstDefNode): AstDefNode {
    const [exprNode, exprTy] = this.analyzeExpr(ast.declare.value, new VarEnv("module"));
    if (ast.declare.ty) {
      if (tyEqual(ast.declare.ty, exprTy)) {
        return {
          nodeType: "def",
          declare: {
            nodeType: "declare",
            name: ast.declare.name,
            ty: ast.declare.ty,
            value: exprNode
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

  private analyzeExpr(ast: AstExprNode, varEnv: VarEnv): [AstExprNode, Type] {
    let astTy;

    if (ast.nodeType === "proc") {
      const [node, ty] = this.analyzeProc(ast, new VarEnv("proc", varEnv));
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
    } else if (ast.nodeType === "variable") {
      const result = varEnv.getVarTyAndLevel(ast.name);
      if (result) {
        const { ty, level, envId } = result;
        ast = { nodeType: "variable", name: ast.name, level, fromEnv: varEnv.envId, toEnv: envId, ty };
        astTy = ty;
      } else {
        const ty = this.defTypeMap.get(ast.name);
        if (ty) {
          ast.ty = ty;
          return [ast, ty];
        }
        throw new Error(`variable not found: ${ast.name}`);
      }
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

  private analyzeProc(ast: AstProcNode, varEnv: VarEnv): [AstProcNode, ProcType] {
    for (const { name, ty } of ast.args) {
      if (ty) {
        varEnv.setVarTy(name, ty);
      } else {
        // TODO: ローカルに関数を定義できるようになったら、型シグネチャを必要としないので、簡易的な型推論が必要になる
        //       引数の型が指定されていない場合、dummyを設定しておく。ここではもうこれで良い
        //       あとで関数のbodyの解析中に決定させる必要がある
        varEnv.setVarTy(name, { tyKind: "dummy" });
      }
    }
    const [bodyAst, bodyType] = this.analyzeExprSeq(ast.body, varEnv);

    // ここではすでに引数の型が決定しているはず
    const argTypes = ast.args.map(({ name, ty }) => {
      if (ty) {
        return ty;
      } else {
        const { ty: resolvedTy, level } = varEnv.getVarTyAndLevel(name)!;
        if (level !== 0) {
          throw new Error("not proc arg");
        }
        return resolvedTy;
      }
    });
    return [
      { nodeType: "proc", args: ast.args, body: bodyAst, envId: varEnv.envId, bodyTy: bodyType, rootTableSize: varEnv.rootTableSize },
      { tyKind: "proc", procKind: "userdef", argTypes, bodyType }
    ];
  }

  private analyzeCall(ast: AstCallNode, varEnv: VarEnv): [AstCallNode, Type] {
    if (ast.callee.nodeType === "proc") {
      const [procAst, procTy] = this.analyzeProc(ast.callee, new VarEnv("proc", varEnv));
      const args = [];
      for (let i = 0; i < procTy.argTypes.length; i++) {
        const [argAst, argTy] = this.analyzeExpr(ast.args[i], varEnv);
        if (!tyEqual(procTy.argTypes[i], argTy)) {
          throw new Error("invalid arg type");
        }
        args.push(argAst);
      }
      return [{ nodeType: "call", callee: procAst, args, ty: procTy.bodyType }, procTy.bodyType];
    }
    if (ast.callee.nodeType === "variable") {
      const [varAst, varTy] = this.analyzeExpr(ast.callee, varEnv);
      if (varTy.tyKind === "primitive" || varTy.tyKind === "dummy") {
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
      return [{ nodeType: "call", callee: varAst, args, ty: varTy.bodyType }, varTy.bodyType];
    }
    throw new Error("invalid callee type");
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

  private analyzeDeclare(ast: AstDeclareNode, varEnv: VarEnv): AstDeclareNode {
    const { name, ty, value } = ast;
    const [ exprAst, exprTy ] = this.analyzeExpr(value, varEnv);

    // TODO: integerリテラルをi32と対応させているが、今後u32等の他の型も登場させると対応関係が崩れる
    //       リテラルと型の対応が一対一でなくなった時に実装を変える必要がある
    if (ty) {
      if (!tyEqual(ty, exprTy)) {
        throw new Error("mismatch type in declaration");
      }
    }
    varEnv.setVarTy(name, exprTy);

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
    if (operandTy.tyKind === "dummy" && operandAst.nodeType === "variable") {
      let ty: Type | undefined;
      if (ast.operator === "!") {
        ty = { tyKind: "primitive", name: "bool" };
      }
      if (ast.operator === "-") {
        ty = { tyKind: "primitive", name: "i32" };
      }
      if (ty) {
        varEnv.setVarTyWithLevel(operandAst.name, ty, operandAst.level);
        ast.ty = ty;
        return [ast, ty];
      } else {
        throw new Error("unreachable");
      }
    }
    throw new Error("invalid unary node type");
  }
}
