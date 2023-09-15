#include "ajisai_runtime.h"

void ajisai_println_i32(int32_t value) {
  printf("%d\n", value);
}

void ajisai_println_bool(bool value) {
  printf("%s\n", value ? "true" : "false");
}

void ajisai_println_str(AjisaiString *value) {
  printf("%s\n", value->value);
}
