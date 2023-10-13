import { Token, isKeyword } from "./token.ts";

export class Lexer {
  src: string;
  #currentPos = 0;
  #lineNo = 0;
  #peek?: Token;

  constructor(src: string) {
    this.src = src;
  }

  nextToken(): Token {
    const currentToken = this.#peek == null ? this.nextTokenImpl() : this.#peek;
    this.#peek = this.nextTokenImpl();
    return currentToken;
  }

  peekToken(): Token {
    if (this.#peek == null) {
      this.#peek = this.nextTokenImpl();
    }
    return this.#peek;
  }

  private nextTokenImpl(): Token {
    this.skipWhitespaces();

    const ch = this.nextChar();
    if (ch == null) {
      return { tokenType: "eof", value: "" };
    }

    switch (ch) {
      case "+":
        return { tokenType: "+", value: "+" };
      case "-":
        if (this.peekChar() === ">") {
          this.nextChar();
          return { tokenType: "->", value: "->" };
        }
        return { tokenType: "-", value: "-" };
      case "*":
        return { tokenType: "*", value: "*" };
      case "/":
        return { tokenType: "/", value: "/" };
      case "%":
        return { tokenType: "%", value: "%" };
      case "=":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { tokenType: "==", value: "==" };
        }
        return { tokenType: "=", value: "=" };
      case "!":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { tokenType: "!=", value: "!=" };
        }
        return { tokenType: "!", value: "!" };
      case "<":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { tokenType: "<=", value: "<=" };
        }
        return { tokenType: "<", value: "<" };
      case ">":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { tokenType: ">=", value: ">=" };
        }
        return { tokenType: ">", value: ">" };
      case ",":
        return { tokenType: ",", value: "," };
      case ":":
        return { tokenType: ":", value: ":" };
      case ";":
        return { tokenType: ";", value: ";" };
      case "&":
        if (this.peekChar() === "&") {
          this.nextChar();
          return { tokenType: "&&", value: "&&" };
        }
        break;
      case "|":
        if (this.peekChar() === "|") {
          this.nextChar();
          return { tokenType: "||", value: "||" };
        }
        return { tokenType: "|", value: "|" };
      case "(":
        return { tokenType: "(", value: "(" };
      case ")":
        return { tokenType: ")", value: ")" };
      case "{":
        return { tokenType: "{", value: "{" };
      case "}":
        return { tokenType: "}", value: "}" };
      case '"':
        return this.readString();
      default:
        if (ch.match(/[1-9]/) || ch === "0" && this.peekChar()?.match(/[^0-9]/)) {
          return this.readNumber(ch);
        }
        if (ch.match(/[A-Za-z_]/)) {
          return this.readIdentifier(ch);
        }
    }

    throw new Error(`Invalid character: ${ch}`);
  }

  private skipWhitespaces() {
    while (true) {
      const ch = this.peekChar();

      if (ch && ch.match(/\s/)) {
        this.nextChar();
      } else {
        break;
      }
    }
  }

  private readNumber(firstCh: string): Token {
    let literal = firstCh;
    while (this.peekChar()?.match(/[0-9]/)) {
      literal += this.nextChar();
    }
    return { tokenType: "integer", value: literal };
  }

  private readIdentifier(firstCh: string): Token {
    let literal = firstCh;
    while (this.peekChar()?.match(/[A-Za-z0-9_]/)) {
      literal += this.nextChar();
    }
    const keyword = isKeyword(literal);
    if (keyword) {
      return { tokenType: keyword, value: literal };
    }
    return { tokenType: "identifier", value: literal };
  }

  private readString(): Token {
    let literal = '"';
    let prevCh = '\0';

    while (true) {
      const nextCh = this.peekChar();
      if (!nextCh) throw new Error("string literal is not closed");

      if (nextCh == '"' && prevCh != '\\') {
        break;
      } else if (nextCh == "\r" || nextCh == "\n") {
        throw new Error("string literal cannot contain newline character");
      }

      prevCh = nextCh;
      literal += this.nextChar();
    }

    literal += this.nextChar(); // add '"'
    return { tokenType: "string", value: literal };
  }

  private nextChar(): string | null {
    if (this.#currentPos == this.src.length) {
      return null;
    } else {
      if (this.peekChar() == "\n") {
        this.#lineNo++;
      }
      return this.src[this.#currentPos++];
    }
  }

  private peekChar(): string | undefined {
    return this.src[this.#currentPos];
  }
}
