export type Type = BuiltinType | ProcType | DummyType;

const builtinTypeNames = ["i32", "bool", "()"] as const;
export type BuiltinTypeName = (typeof builtinTypeNames)[number];
export type BuiltinType = { tyKind: "builtin", name: BuiltinTypeName };

export const isBuiltinTypeName = (s: string): BuiltinTypeName | null => {
  return (builtinTypeNames as Readonly<string[]>).includes(s) ? s as BuiltinTypeName : null;
};

export type ProcType = { tyKind: "proc", argTypes: Type[], bodyType: Type };

export type DummyType = { tyKind: "dummy" };

export const tyEqual = (left: Type, right: Type): boolean => {
  if (left.tyKind == "builtin" && right.tyKind == "builtin") {
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
