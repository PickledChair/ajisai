#include <assert.h>
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

#define AJISAI_MEMCELL_POP_OWN(manager, cell) do { \
    (cell)->next->prev = (cell)->prev; \
    (cell)->prev->next = (cell)->next; \
    if ((cell) == (manager)->top) { \
      (manager)->top = (cell)->prev; \
    } \
    if ((cell) == (manager)->scan) { \
      (manager)->scan = (cell)->prev; \
    } \
    (cell)->next = (cell)->prev = NULL; \
  } while (0)

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
#define AJISAI_BLOCKS_MEMCELL_COUNT 512
#endif // AJISAI_BLOCKS_MEMCELL_COUNT

typedef struct {
  AjisaiMemCell *memcells;
  AjisaiMemCell new_edge, *bottom;
} AjisaiFreeMemCells;

typedef struct {
  AjisaiMemCellAllocator memcell_allocator;
  AjisaiMemCell *top, *scan;
  AjisaiFreeMemCells free;
  bool gc_in_progress;
} AjisaiMemManager;

int ajisai_mem_manager_init(AjisaiMemManager *manager);
void ajisai_mem_manager_deinit(AjisaiMemManager *manager);
void ajisai_mem_manager_append_to_to_space(AjisaiMemManager *manager, AjisaiMemCell *cell);

typedef enum {
  AJISAI_OBJ_STR_STATIC,
  AJISAI_OBJ_STR_HEAP,
  AJISAI_OBJ_STR_SLICE,
} AjisaiObjTag;

typedef struct AjisaiObject AjisaiObject;

typedef struct {
  void (*scan_func)(AjisaiMemManager *, AjisaiObject *);
} AjisaiTypeInfo;

struct AjisaiObject {
  AjisaiObjTag tag;
  AjisaiTypeInfo *type_info;
};

#define AJISAI_OBJ_GET_OWNER_CELL(obj) ((AjisaiByteData *)((uint8_t *)(obj) - sizeof(AjisaiByteData)))->owner_cell

typedef struct AjisaiString AjisaiString;
struct AjisaiString {
  AjisaiObject obj_header;
  size_t len;
  char *value;
  AjisaiString *src;
};

typedef struct ProcFrame ProcFrame;
struct ProcFrame {
  ProcFrame *parent;
  AjisaiMemManager *mem_manager;
  size_t root_table_size;
  AjisaiObject **root_table;
};

AjisaiObject *ajisai_object_alloc(ProcFrame *proc_frame, size_t size);
void ajisai_gc_start(ProcFrame *proc_frame);

void ajisai_print_i32(int32_t value);
void ajisai_println_i32(int32_t value);
void ajisai_print_bool(bool value);
void ajisai_println_bool(bool value);
void ajisai_print_str(AjisaiString *value);
void ajisai_println_str(AjisaiString *value);
void ajisai_flush(void);

AjisaiTypeInfo *ajisai_str_type_info(void);
AjisaiString *ajisai_str_concat(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b);
// TODO: 範囲指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_slice(ProcFrame *proc_frame, AjisaiString *src, int32_t start, int32_t end);
bool ajisai_str_equal(AjisaiString *left, AjisaiString *right);
// TODO: 反復回数指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_repeat(ProcFrame *proc_frame, AjisaiString *src, int32_t count);
