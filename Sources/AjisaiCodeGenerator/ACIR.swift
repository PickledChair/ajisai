import AjisaiSemanticAnalyzer

//
// ACIR -- Ajisai-C Intermediate Representation
//

// プログラム全体
public struct ACProgram {
    public let decls: [ACDeclInst]
    public let funcDefs: [ACDefInst]
    public let modInitDefs: [ACModInitDefInst]
    public let entryModName: String
    public let globalRootTableSize: UInt
}

public enum ACDeclInst {
    // モジュールレベル関数のプロトタイプ宣言
    case func_decl(
        funcName: String, params: [(name: String, ty: AjisaiType)], returnTy: AjisaiType,
        modName: String)
    // クロージャ本体のプロトタイプ宣言
    case closure_decl(
        funcName: String, params: [(name: String, ty: AjisaiType)], returnTy: AjisaiType)
    // モジュールレベル変数の未初期化状態の定義（実際には宣言ではない）
    case val_decl(varName: String, ty: AjisaiType, modName: String)
}

public enum ACDefInst {
    // モジュールレベル関数の定義
    case func_def(
        funcName: String, params: [(name: String, ty: AjisaiType)], returnTy: AjisaiType,
        modName: String, envId: UInt, body: [ACFuncBodyInst])
    // クロージャ本体の定義
    case closure_def(
        funcName: String, params: [(name: String, ty: AjisaiType)], returnTy: AjisaiType,
        envId: UInt, body: [ACFuncBodyInst])
}

// モジュール初期化関数の定義命令
public struct ACModInitDefInst {
    public let body: [ACModInitBodyInst]
    public let modName: String
}

public enum ACModInitBodyInst {
    // モジュール初期化関数を実行する命令
    case mod_init(modName: String)
    // モジュールレベル変数を初期化する命令
    case modval_init(varName: String, modName: String, value: ACValueInst)
    // モジュールレベル変数をグローバルのルート集合のテーブルに追加する命令
    case global_roottable_reg(idx: UInt, varName: String, modName: String)
    // その他、関数内の一般的な命令
    case func_body_inst(ACFuncBodyInst)
}

public enum ACFuncBodyInst {
    // 関数先頭で作成する関数フレーム情報を初期化する命令
    case funcframe_init(rootTableSize: UInt)

    // ルート集合のテーブルに関連する命令
    case roottable_init(size: UInt)
    case roottable_reg(envId: UInt, rootTableIdx: UInt, tmpVarIdx: UInt)
    case roottable_unreg(rootTableIdx: UInt)

    // 一時変数の定義と、一時変数への代入
    case tmp_def(envId: UInt, tmpVarIdx: UInt, ty: AjisaiType, value: ACValueInst)
    case tmp_def_without_value(envId: UInt, tmpVarIdx: UInt, ty: AjisaiType)
    case tmp_store(envId: UInt, tmpVarIdx: UInt, value: ACValueInst)

    // ローカル変数の定義
    case envvar_def(envId: UInt, varName: String, ty: AjisaiType, value: ACValueInst)

    // 静的領域に文字列オブジェクトを作成する命令
    case str_make_static(id: UInt, value: String, len: UInt)
    // 静的領域にクロージャオブジェクトを作成する命令
    case closure_make_static(id: UInt, funcKind: AjisaiFuncKind, name: String, modName: String?)

    // if (...) { ... } else { ... }
    case ifelse(cond: ACValueInst, then: [ACFuncBodyInst], els: [ACFuncBodyInst])

    // 値を評価してそのまま捨てる命令
    // 想定される命令は func_call および closure_call
    case discard_value(ACValueInst)

    // 関数から return する命令
    case func_return(value: ACValueInst)
}

public enum ACValueInst {
    // 変数参照命令
    case builtin_load(name: String)  // 組み込み関数名
    case modval_load(modName: String, varName: String)  // モジュールレベル変数名
    case envvar_load(envId: UInt, varName: String)  // ローカル変数名
    case tmp_load(envId: UInt, index: UInt)  // 一時変数名

    // 関数呼び出し命令
    indirect case func_call(callee: ACValueInst, args: [ACValueInst])
    indirect case closure_call(
        callee: ACValueInst, args: [ACValueInst], argTypes: [AjisaiType], bodyType: AjisaiType)

    // 32 bit 符号付き整数関連の命令
    case i32_const(value: Int)
    indirect case i32_neg(operand: ACValueInst)
    indirect case i32_add(left: ACValueInst, right: ACValueInst)
    indirect case i32_sub(left: ACValueInst, right: ACValueInst)
    indirect case i32_mul(left: ACValueInst, right: ACValueInst)
    indirect case i32_div(left: ACValueInst, right: ACValueInst)
    indirect case i32_mod(left: ACValueInst, right: ACValueInst)
    indirect case i32_eq(left: ACValueInst, right: ACValueInst)
    indirect case i32_ne(left: ACValueInst, right: ACValueInst)
    indirect case i32_lt(left: ACValueInst, right: ACValueInst)
    indirect case i32_le(left: ACValueInst, right: ACValueInst)
    indirect case i32_gt(left: ACValueInst, right: ACValueInst)
    indirect case i32_ge(left: ACValueInst, right: ACValueInst)

    // Bool 値関連の命令
    case bool_const(value: Bool)
    indirect case bool_not(operand: ACValueInst)
    indirect case bool_eq(left: ACValueInst, right: ACValueInst)
    indirect case bool_ne(left: ACValueInst, right: ACValueInst)
    indirect case bool_and(left: ACValueInst, right: ACValueInst)
    indirect case bool_or(left: ACValueInst, right: ACValueInst)

    // 文字列型の値を表す命令
    // 静的領域の文字列データは str_make_static 命令で定義し、それを id で参照する
    case str_const(id: UInt)

    // クロージャ関連の命令
    // モジュールレベルの関数を関数オブジェクトとして扱うためのクロージャデータを
    // closure_make_static 命令で静的領域に定義する。この命令は値を返さないので、str_const 命令を
    // 使って、id 指定で値にアクセスする。
    // それ以外の、関数内でローカルに定義される関数のオブジェクトは closure_make 命令で定義する。
    // この命令は値を直接返す。
    case closure_const(id: UInt)
    case closure_make(id: UInt)
}
