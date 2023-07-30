import { VarEnv } from "./env.ts";
import { Type, BuiltinType, tyEqual, ProcType } from "./type.ts";
import { AstBinaryNode, AstLetNode, AstDeclareNode, AstUnaryNode, AstIfNode, AstExprNode, AstDefNode, AstModuleNode, AstProcNode, AstCallNode } from "./ast.ts";

type DefTypeMap = Map<string, Type>;

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
    "println_i32",
    {
      tyKind: "proc",
      argTypes: [{ tyKind: "builtin", name: "i32" }],
      bodyType: { tyKind: "builtin", name: "()" }
    }
  );
  defTypeMap.set(
    "println_bool",
    {
      tyKind: "proc",
      argTypes: [{ tyKind: "builtin", name: "bool" }],
      bodyType: { tyKind: "builtin", name: "()" }
    }
  );
  return defTypeMap;
};

export const semantAnalyze = (ast: AstModuleNode): AstModuleNode => {
  return {
    nodeType: "module",
    defs: ast.defs.map(def => analyzeDef(def, makeDefTypeMap(ast)))
  };
};

const analyzeDef = (ast: AstDefNode, defTypeMap: DefTypeMap): AstDefNode => {
  const [exprNode, exprTy] = analyzeExpr(ast.declare.value, new VarEnv(), defTypeMap);
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
};

const analyzeExpr = (ast: AstExprNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstExprNode, Type] => {
  let astTy;

  if (ast.nodeType === "proc") {
    const [node, ty] = analyzeProc(ast, new VarEnv(varEnv), defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "call") {
    const [node, ty] = analyzeCall(ast, varEnv, defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "let") {
    const [node, ty] = analyzeLet(ast, new VarEnv(varEnv), defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "if") {
    const [node, ty] = analyzeIf(ast, varEnv, defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "binary") {
    const [node, ty] = analyzeBinary(ast, varEnv, defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "unary") {
    const [node, ty] = analyzeUnary(ast, varEnv, defTypeMap);
    ast = node;
    astTy = ty;
  } else if (ast.nodeType === "variable") {
    const result = varEnv.getVarTyAndLevel(ast.name);
    if (result) {
      const { ty, level, envId } = result;
      ast = { nodeType: "variable", name: ast.name, level, fromEnv: varEnv.envId, toEnv: envId };
      astTy = ty;
    } else {
      const ty = defTypeMap.get(ast.name);
      if (ty) {
        return [ast, ty];
      }
      throw new Error(`variable not found: ${ast.name}`);
    }
  } else if (ast.nodeType === "integer") {
    astTy = { tyKind: "builtin", name: "i32" } as BuiltinType;
  } else if (ast.nodeType === "bool") {
    astTy = { tyKind: "builtin", name: "bool" } as BuiltinType;
  } else if (ast.nodeType === "unit") {
    astTy = { tyKind: "builtin", name: "()" } as BuiltinType;
  } else {
    throw new Error("unreachable");
  }

  return [ast, astTy];
};

const analyzeProc = (ast: AstProcNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstProcNode, ProcType] => {
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
  const [bodyAst, bodyType] = analyzeExpr(ast.body, varEnv, defTypeMap);

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
    { nodeType: "proc", args: ast.args, body: bodyAst, envId: varEnv.envId },
    { tyKind: "proc", argTypes, bodyType }
  ];
};

const analyzeCall = (ast: AstCallNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstCallNode, Type] => {
  if (ast.callee.nodeType === "proc") {
    const [procAst, procTy] = analyzeProc(ast.callee, new VarEnv(varEnv), defTypeMap);
    const args = [];
    for (let i = 0; i < procTy.argTypes.length; i++) {
      const [argAst, argTy] = analyzeExpr(ast.args[i], varEnv, defTypeMap);
      if (!tyEqual(procTy.argTypes[i], argTy)) {
        throw new Error("invalid arg type");
      }
      args.push(argAst);
    }
    return [{ nodeType: "call", callee: procAst, args }, procTy.bodyType];
  }
  if (ast.callee.nodeType === "variable") {
    const [varAst, varTy] = analyzeExpr(ast.callee, varEnv, defTypeMap);
    if (varTy.tyKind === "builtin" || varTy.tyKind === "dummy") {
      throw new Error("invalid callee type");
    }
    const args = [];
    for (let i = 0; i < varTy.argTypes.length; i++) {
      const [argAst, argTy] = analyzeExpr(ast.args[i], varEnv, defTypeMap);
      if (!tyEqual(varTy.argTypes[i], argTy)) {
        throw new Error("invalid arg type");
      }
      args.push(argAst);
    }
    return [{ nodeType: "call", callee: varAst, args }, varTy.bodyType];
  }
  throw new Error("invalid callee type");
};

const analyzeLet = (ast: AstLetNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstLetNode, Type] => {
  const newDeclares: AstDeclareNode[] = [];
  for (const declare of ast.declares) {
    // TODO: 重複したローカル変数名でエラーを出す
    newDeclares.push(analyzeDeclare(declare, varEnv, defTypeMap));
  }

  const [bodyAst, bodyTy] = analyzeExpr(ast.body, varEnv, defTypeMap);

  return [{ nodeType: "let", declares: newDeclares, body: bodyAst, bodyTy, envId: varEnv.envId }, bodyTy];
};

const analyzeDeclare = (ast: AstDeclareNode, varEnv: VarEnv, defTypeMap: DefTypeMap): AstDeclareNode => {
  const { name, ty, value } = ast;
  const [ exprAst, exprTy ] = analyzeExpr(value, varEnv, defTypeMap);

  // TODO: integerリテラルをi32と対応させているが、今後u32等の他の型も登場させると対応関係が崩れる
  //       リテラルと型の対応が一対一でなくなった時に実装を変える必要がある
  if (ty) {
    if (!tyEqual(ty, exprTy)) {
      throw new Error("mismatch type in declaration");
    }
  }
  varEnv.setVarTy(name, exprTy);

  return { nodeType: "declare", name, ty: exprTy, value: exprAst };
};

const analyzeIf = (ast: AstIfNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstIfNode, Type] => {
  const [ cond, condTy ] = analyzeExpr(ast.cond, varEnv, defTypeMap);
  if (!(condTy.tyKind === "builtin" && condTy.name === "bool")) {
    throw new Error("condition expression of 'if' must be bool type");
  }

  const [ then, thenTy ] = analyzeExpr(ast.then, varEnv, defTypeMap);
  const [ else_, elseTy ] = analyzeExpr(ast.else, varEnv, defTypeMap);

  if (!tyEqual(thenTy, elseTy)) {
    throw new Error("mismatch type between then clause and else clause in if expression");
  }

  return [{ nodeType: "if", cond, then, else: else_, ty: thenTy }, thenTy];
};

const analyzeBinary = (ast: AstBinaryNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstBinaryNode, Type] => {
  const [leftAst, leftTy] = analyzeExpr(ast.left, varEnv, defTypeMap);
  const [rightAst, rightTy] = analyzeExpr(ast.right, varEnv, defTypeMap);

  if (!tyEqual(leftTy, rightTy)) {
    throw new Error(`invalid binary expression`);
  }

  ast.left = leftAst;
  ast.right = rightAst;

  // TODO: bool型とi32型の時、また型が決まっていないローカル変数の時の条件分岐を考える
  //       ローカルに無名関数を定義できるようになったらよく考える必要がある
  if (leftTy.tyKind === "builtin" && rightTy.tyKind === "builtin") {
    const ty: Type = ["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(ast.operator) ? { tyKind: "builtin", name: "bool" } : leftTy;
    return [ast, ty];
  }

  return [ast, leftTy];
};

const analyzeUnary = (ast: AstUnaryNode, varEnv: VarEnv, defTypeMap: DefTypeMap): [AstUnaryNode, Type] => {
  const [operandAst, operandTy] = analyzeExpr(ast.operand, varEnv, defTypeMap);
  ast.operand = operandAst;
  if (operandTy.tyKind === "builtin") {
    if (ast.operator === "!" && operandTy.name !== "bool") {
      throw new Error("'!' operator with non-boolean operand");
    }
    if (ast.operator === "-" && operandTy.name !== "i32") {
      throw new Error("'-' operator with non-integer operand");
    }
    return [ast, operandTy];
  }
  if (operandTy.tyKind === "dummy" && operandAst.nodeType === "variable") {
    let ty: Type | undefined;
    if (ast.operator === "!") {
      ty = { tyKind: "builtin", name: "bool" };
    }
    if (ast.operator === "-") {
      ty = { tyKind: "builtin", name: "i32" };
    }
    if (ty) {
      varEnv.setVarTyWithLevel(operandAst.name, ty, operandAst.level);
      return [ast, ty];
    } else {
      throw new Error("unreachable");
    }
  }
  throw new Error("invalid unary node type");
};
