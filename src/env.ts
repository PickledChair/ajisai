import { Type } from "./type.ts";

let freshEnvId = 0;

export class VarEnv {
  envId: number;
  parent_?: VarEnv;
  #variables: Map<string, Type>;

  constructor(parent?: VarEnv) {
    this.envId = freshEnvId++;
    this.parent_ = parent;
    this.#variables = new Map();
  }

  getVarTyAndLevel(name: string): { ty: Type, level: number, envId: number } | undefined {
    const ty_ = this.#variables.get(name);
    if (ty_) {
      return { ty: ty_, level: 0, envId: this.envId };
    } else {
      if (this.parent_) {
        const result = this.parent_.getVarTyAndLevel(name);
        if (result) {
          const { ty, level, envId } = result;
          return { ty, level: level+1, envId };
        }
      }
    }
    return undefined;
  }

  setVarTy(name: string, ty: Type) {
    this.#variables.set(name, ty);
  }

  setVarTyWithLevel(name: string, ty: Type, level: number) {
    if (level === 0) {
      this.setVarTy(name, ty);
    } else {
      this.parent_?.setVarTyWithLevel(name, ty, level-1);
    }
  }
}
