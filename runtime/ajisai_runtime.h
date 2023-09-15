#include <stdbool.h>
#include <stdio.h>
#include <stdint.h>

typedef struct {
  char *value;
} AjisaiString;

typedef struct ProcFrame ProcFrame;
struct ProcFrame {
  ProcFrame *parent;
};

void ajisai_println_i32(int32_t value);
void ajisai_println_bool(bool value);
void ajisai_println_str(AjisaiString *value);
