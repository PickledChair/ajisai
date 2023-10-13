export type Type = PrimitiveType | ProcType | DummyType;

const primitiveTypeNames = ["i32", "bool", "str", "()"] as const;
export type PrimitiveTypeName = (typeof primitiveTypeNames)[number];
export type PrimitiveType = { tyKind: "primitive", name: PrimitiveTypeName };

export const isPrimitiveTypeName = (s: string): PrimitiveTypeName | null => {
  return (primitiveTypeNames as Readonly<string[]>).includes(s) ? s as PrimitiveTypeName : null;
};

export type ProcKind = "userdef" | "builtin" | "builtinWithFrame";
export type ProcType = { tyKind: "proc", procKind: ProcKind, argTypes: Type[], bodyType: Type };

export type DummyType = { tyKind: "dummy" };

export const tyEqual = (left: Type, right: Type): boolean => {
  if (left.tyKind == "primitive" && right.tyKind == "primitive") {
    return left.name == right.name;
  } else if (left.tyKind == "proc" && right.tyKind == "proc") {
    if (left.argTypes.length !== right.argTypes.length) return false;

    for (let i = 0; i < left.argTypes.length; i++) {
      if (!tyEqual(left.argTypes[i], right.argTypes[i])) return false;
    }

    if (!tyEqual(left.bodyType, right.bodyType)) return false;

    return true;
  }
  return false;
};

export const toCType = (ty: Type): string => {
  if (ty.tyKind === "primitive") {
    switch (ty.name) {
      case "i32": return "int32_t";
      case "bool": return "bool";
      case "str": return "AjisaiString *";
      case "()": return "void";
    }
  } else if (ty.tyKind === "proc") {
    throw new Error("unimplemented for proc");
  }
  throw new Error("invalid type");
};

export const mayBeHeapObj = (ty: Type): boolean => {
  if (ty.tyKind === "primitive") {
    switch (ty.name) {
      case "i32":
      case "bool":
      case "()":
        return false;
      case "str":
        return true;
    }
  }
  // proc 等
  return true;
};
