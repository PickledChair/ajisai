#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

typedef struct AjisaiMemCell AjisaiMemCell;

typedef struct {
  AjisaiMemCell *owner_cell;
  uint8_t data[];
} AjisaiByteData;

struct AjisaiMemCell {
  size_t size;
  AjisaiMemCell *prev, *next;
  AjisaiByteData *data;
};

typedef struct AjisaiMemCellBlock AjisaiMemCellBlock;
struct AjisaiMemCellBlock {
  size_t memcell_count, memcell_next_idx;
  AjisaiMemCell *block;
  AjisaiMemCellBlock *next;
};

typedef struct {
  AjisaiMemCellBlock *blocks;
} AjisaiMemCellAllocator;

#ifndef AJISAI_BLOCKS_MEMCELL_COUNT
#define AJISAI_BLOCKS_MEMCELL_COUNT 128
#endif // AJISAI_BLOCKS_MEMCELL_COUNT

typedef struct {
  AjisaiMemCell *memcells;
  AjisaiMemCell new_edge, *bottom;
} AjisaiFreeMemCells;

typedef struct {
  AjisaiMemCellAllocator memcell_allocator;
  AjisaiMemCell *top, *scan;
  AjisaiFreeMemCells free;
} AjisaiMemManager;

int ajisai_mem_manager_init(AjisaiMemManager *manager);
void ajisai_mem_manager_deinit(AjisaiMemManager *manager);

typedef struct ProcFrame ProcFrame;
struct ProcFrame {
  ProcFrame *parent;
  AjisaiMemManager *mem_manager;
};

void *ajisai_malloc(ProcFrame *proc_frame, size_t size);

typedef enum {
  AJISAI_OBJ_STR_STATIC,
  AJISAI_OBJ_STR_HEAP,
  AJISAI_OBJ_STR_SLICE,
} AjisaiObjTag;

typedef struct AjisaiObject AjisaiObject;
 struct AjisaiObject {
  AjisaiObjTag tag;
  void (*collect_root_func)(AjisaiObject *);
};

typedef struct AjisaiString AjisaiString;
struct AjisaiString {
  AjisaiObject obj_header;
  size_t len;
  char *value;
  AjisaiString *src;
};

void ajisai_print_i32(int32_t value);
void ajisai_println_i32(int32_t value);
void ajisai_print_bool(bool value);
void ajisai_println_bool(bool value);
void ajisai_print_str(AjisaiString *value);
void ajisai_println_str(AjisaiString *value);
void ajisai_flush(void);

AjisaiString *ajisai_str_concat(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b);
// TODO: 範囲指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_slice(ProcFrame *proc_frame, AjisaiString *src, int32_t start, int32_t end);
bool ajisai_str_equal(AjisaiString *left, AjisaiString *right);
// TODO: 反復回数指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_repeat(ProcFrame *proc_frame, AjisaiString *src, int32_t count);
