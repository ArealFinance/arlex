/**
 * Arlex IDL types — Anchor-compatible format
 */

export interface Idl {
  version: string;
  name: string;
  metadata?: { address?: string };
  instructions: IdlInstruction[];
  accounts: IdlAccountDef[];
  types?: IdlTypeDef[];
  events?: IdlEvent[];
  errors?: IdlError[];
}

export interface IdlInstruction {
  name: string;
  accounts: IdlAccountItem[];
  args: IdlField[];
}

export interface IdlAccountItem {
  name: string;
  isMut: boolean;
  isSigner: boolean;
}

export interface IdlField {
  name: string;
  type: IdlType;
}

export type IdlType =
  | string  // "u8", "u64", "publicKey", "bool", etc.
  | { vec: IdlType }
  | { option: IdlType }
  | { array: [IdlType, number] }
  | { defined: string };

export interface IdlAccountDef {
  name: string;
  type: {
    kind: string;
    fields: IdlField[];
  };
}

export interface IdlTypeDef {
  name: string;
  type: { kind: string; fields?: IdlField[]; variants?: { name: string }[] };
}

export interface IdlEvent {
  name: string;
  fields: IdlField[];
}

export interface IdlError {
  code: number;
  name: string;
  msg: string;
}
