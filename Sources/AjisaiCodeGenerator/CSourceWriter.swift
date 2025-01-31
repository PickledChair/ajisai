import AjisaiSemanticAnalyzer
import Foundation

let defaultFileHeader = "#include <ajisai_runtime.h>\n\n"

typealias WriteFunc = (String) -> Void

public func writeCSource<Target>(program: ACProgram, to target: inout Target)
where Target: TextOutputStream {
    func write(_ str: String) {
        target.write(str)
    }

    write(defaultFileHeader)

    program.decls.forEach { decl in writeDecl(write: write, decl: decl) }

    program.modInitDefs.forEach { modInitDef in
        write("static void modinit__\(modInitDef.modName)(AjisaiFuncFrame *parent_frame);\n")
    }

    if program.globalRootTableSize > 0 {
        write("\nstatic AjisaiObject *global_root_table[\(program.globalRootTableSize)] = {};\n")
    }

    program.funcDefs.forEach { funcDef in
        write("\n")
        writeFuncDef(write: write, def: funcDef)
    }

    program.modInitDefs.forEach { modInit in
        write("\n")
        writeModInitDef(write: write, modInit: modInit)
    }

    write("\n")
    writeMain(write: write, program: program)
}

func writeDecl(write: WriteFunc, decl: ACDeclInst) {
    switch decl {
    case let .val_decl(varName: varName, ty: ty, modName: modName):
        writeGlobalVar(write: write, varName: varName, ty: ty, modName: modName)
    case let .func_decl(funcName: funcName, params: params, returnTy: returnTy, modName: modName):
        writeProtoType(
            write: write, funcName: funcName, params: params, returnTy: returnTy, modName: modName)
    case let .closure_decl(funcName: funcName, params: params, returnTy: returnTy):
        writeProtoType(
            write: write, funcName: funcName, params: params, returnTy: returnTy, modName: nil)
    }
}

func writeProtoType(
    write: WriteFunc, funcName: String, params: [(name: String, ty: AjisaiType)],
    returnTy: AjisaiType, modName: String?
) {
    let prefix = if let modName = modName { "userdef__\(modName)_" } else { "closure" }
    write(
        "static \(returnTy.cRepresentation()) \(prefix)_\(funcName)(AjisaiFuncFrame *parent_frame")

    for (paramName, paramTy) in params {
        write(", \(paramTy.cRepresentation()) \(paramName)")
    }

    write(");\n")
}

func writeGlobalVar(write: WriteFunc, varName: String, ty: AjisaiType, modName: String) {
    write("static \(ty.cRepresentation()) userdef__\(modName)__\(varName);\n")
}

func writeMain(write: WriteFunc, program: ACProgram) {
    write("int main() {\n")
    write("  AjisaiMemManager mem_manager;\n")
    // TODO: メモリ確保に失敗した時に終了する処理を入れる
    write("  ajisai_mem_manager_init(&mem_manager);\n")

    write(
        "  AjisaiFuncFrame func_frame = { .parent = NULL, .mem_manager = &mem_manager, .root_table_size = \(program.globalRootTableSize)"
    )
    if program.globalRootTableSize > 0 {
        write(", .root_table = global_root_table")
    }
    write(" };\n")

    write("  modinit__\(program.entryModName)(&func_frame);\n")

    write("  ajisai_mem_manager_deinit(&mem_manager);\n")
    write("  return 0;\n")
    write("}\n")
}

func writeModInitDef(write: WriteFunc, modInit: ACModInitDefInst) {
    write("static void modinit__\(modInit.modName)(AjisaiFuncFrame *parent_frame) {\n")
    write("  static bool is_initialized = false;\n")
    write("  if (!is_initialized) {\n")
    modInit.body.forEach { inst in
        switch inst {
        case let .mod_init(modName: modName):
            write("  modinit__\(modName)(&func_frame);\n")
        case let .modval_init(varName: varName, modName: modName, value: value):
            write("  userdef__\(modName)__\(varName) = \(writeValueInst(valInst: value));\n")
        case let .global_roottable_reg(idx: rootIdx, varName: varName, modName: modName):
            write(
                "  global_root_table[\(rootIdx)] = (AjisaiObject *)userdef__\(modName)__\(varName);\n"
            )
        case let .func_body_inst(funcBodyInst):
            writeFuncBodyInst(write: write, funcBodyInst: funcBodyInst)
        }
    }
    write("  is_initialized = true;\n")
    write("  }\n")
    write("}\n")
}

func writeFuncDef(write: WriteFunc, def: ACDefInst) {
    let funcName: String
    let params: [(name: String, ty: AjisaiType)]
    let returnTy: AjisaiType
    var modName: String? = nil
    let envId: UInt
    let body: [ACFuncBodyInst]
    switch def {
    case let .func_def(
        funcName: funcName1, params: params1, returnTy: returnTy1, modName: modName1, envId: envId1,
        body: body1):
        funcName = funcName1
        params = params1
        returnTy = returnTy1
        modName = modName1
        envId = envId1
        body = body1
    case let .closure_def(
        funcName: funcName1, params: params1, returnTy: returnTy1, envId: envId1, body: body1):
        funcName = funcName1
        params = params1
        returnTy = returnTy1
        envId = envId1
        body = body1
    }

    write("static \(returnTy.cRepresentation()) ")
    if let modName = modName {
        write("userdef__\(modName)_")
    } else {
        write("closure")
    }
    write("_\(funcName)(AjisaiFuncFrame *parent_frame")
    params.forEach { param in write(", \(param.ty.cRepresentation()) env\(envId)_var_\(param.name)")
    }
    write(") {\n")
    body.forEach { inst in writeFuncBodyInst(write: write, funcBodyInst: inst) }
    write("}\n")
}

func writeFuncBodyInst(write: WriteFunc, funcBodyInst: ACFuncBodyInst) {
    switch funcBodyInst {
    case let .roottable_init(size: size):
        write("  AjisaiObject *root_table[\(size)] = {};\n")
    case let .roottable_reg(envId: envId, rootTableIdx: rootIdx, tmpVarIdx: tmpId):
        write("  root_table[\(rootIdx)] = (AjisaiObject *)env\(envId)_tmp\(tmpId);\n")
    case let .roottable_unreg(rootTableIdx: rootIdx):
        write("  root_table[\(rootIdx)] = NULL;\n")
    case let .funcframe_init(rootTableSize: rootTableSize):
        write(
            "  AjisaiFuncFrame func_frame = { .parent = parent_frame, .mem_manager = parent_frame->mem_manager, .root_table_size = \(rootTableSize)"
        )
        if rootTableSize > 0 {
            write(", .root_table = root_table")
        }
        write(" };\n")
    case let .func_return(value: value):
        write("  return \(writeValueInst(valInst: value));\n")
    case let .envvar_def(envId: envId, varName: varName, ty: ty, value: value):
        write(
            "  \(ty.cRepresentation()) env\(envId)_var_\(varName) = \(writeValueInst(valInst: value));\n"
        )
    case let .tmp_def(envId: envId, tmpVarIdx: tmpId, ty: ty, value: value):
        write(
            "  \(ty.cRepresentation()) env\(envId)_tmp\(tmpId) = \(writeValueInst(valInst: value));\n"
        )
    case let .tmp_def_without_value(envId: envId, tmpVarIdx: tmpId, ty: ty):
        write("  \(ty.cRepresentation()) env\(envId)_tmp\(tmpId);\n")
    case let .tmp_store(envId: envId, tmpVarIdx: tmpId, value: value):
        write("  env\(envId)_tmp\(tmpId) = \(writeValueInst(valInst: value));\n")
    case let .ifelse(cond: cond, then: then, els: els):
        write("  if (\(writeValueInst(valInst: cond))) {\n")
        then.forEach { inst in writeFuncBodyInst(write: write, funcBodyInst: inst) }
        write("  } else {\n")
        els.forEach { inst in writeFuncBodyInst(write: write, funcBodyInst: inst) }
        write("  }\n")
    case let .str_make_static(id: tmpId, value: value, len: len):
        write(
            "  static AjisaiString static_str\(tmpId) = { .obj_header = { .tag = AJISAI_OBJ_STR }, .len = \(len), .value = \"\(value)\" };\n"
        )
        write("  static_str\(tmpId).obj_header.type_info = ajisai_str_type_info();\n")
    case let .closure_make_static(id: closureId, funcKind: funcKind, name: name, modName: modName):
        write("  static AjisaiClosure static_closure\(closureId) = ")
        write(
            "{ .obj_header = { .tag = AJISAI_OBJ_FUNC }, .func_ptr = \(funcKind == .builtin ? "ajisai" : "userdef__\(modName!)_")_\(name) };\n"
        )
        write("  static_closure\(closureId).obj_header.type_info = ajisai_func_type_info();\n")
    case let .discard_value(valInst):
        write("  \(writeValueInst(valInst: valInst));\n")
    }
}

func writeValueInst(valInst: ACValueInst) -> String {
    func inner(valInst: ACValueInst, isTop: Bool) -> String {
        switch valInst {
        case let .builtin_load(name: name):
            return "ajisai_\(name)"
        case let .modval_load(modName: modName, varName: varName):
            return "userdef__\(modName)__\(varName)"
        case let .envvar_load(envId: envId, varName: varName):
            return "env\(envId)_var_\(varName)"
        case let .tmp_load(envId: envId, index: index):
            return "env\(envId)_tmp\(index)"
        case let .func_call(callee: callee, args: args):
            let callee = inner(valInst: callee, isTop: false)
            let args = args.map { arg in inner(valInst: arg, isTop: false) }
            return
                "\(callee)(&func_frame\(args.isEmpty ? "" : ", " + args.joined(separator: ", ")))"
        case let .closure_call(callee: callee, args: args, argTypes: argTypes, bodyType: bodyType):
            let closure = inner(valInst: callee, isTop: false)
            let args = args.map { arg in inner(valInst: arg, isTop: false) }
            let argCTypes = argTypes.map { ajisaiType in ajisaiType.cRepresentation() }
            let bodyCType = bodyType.cRepresentation()
            let callee =
                "((\(bodyCType) (*)(AjisaiFuncFrame *\(argCTypes.isEmpty ? "" : ", " + argCTypes.joined(separator: ", "))))\(closure)->func_ptr)"
            return
                "\(callee)(&func_frame\(args.isEmpty ? "" : ", " + args.joined(separator: ", ")))"
        case let .closure_make(id: closureId):
            return "ajisai_closure_new(&func_frame, closure_\(closureId), NULL)"
        case let .i32_const(value: value):
            return "\(value)"
        case let .bool_const(value: value):
            return "\(value)"
        case let .str_const(id: tmpId):
            return "&static_str\(tmpId)"
        case let .closure_const(id: closureId):
            return "&static_closure\(closureId)"
        case let .i32_add(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) + \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_sub(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) - \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_mul(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) * \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_div(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) / \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_mod(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) % \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_neg(operand: operand):
            return "-\(inner(valInst: operand, isTop: false))"
        case let .bool_not(operand: operand):
            return "!\(inner(valInst: operand, isTop: false))"
        case let .i32_eq(left: left, right: right), let .bool_eq(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) == \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_ne(left: left, right: right), let .bool_ne(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) != \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_lt(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) < \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_le(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) <= \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_gt(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) > \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .i32_ge(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) >= \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .bool_and(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) && \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        case let .bool_or(left: left, right: right):
            let expr =
                "\(inner(valInst: left, isTop: false)) || \(inner(valInst: right, isTop: false))"
            return isTop ? expr : "(\(expr))"
        }
    }
    return inner(valInst: valInst, isTop: true)
}
