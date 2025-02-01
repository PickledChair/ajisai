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
    (cell)->next->prev = (cell)->prev;             \
    (cell)->prev->next = (cell)->next;             \
    if ((cell) == (manager)->top) {                \
      (manager)->top = (cell)->prev;               \
    }                                              \
    if ((cell) == (manager)->scan) {               \
      (manager)->scan = (cell)->prev;              \
    }                                              \
    (cell)->next = (cell)->prev = NULL;            \
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

typedef enum {
  AJISAI_WHITE,
  AJISAI_BLACK,
} AjisaiObjColor;

typedef struct {
  AjisaiMemCellAllocator memcell_allocator;
  AjisaiMemCell *top, *scan;
  AjisaiFreeMemCells free;
  bool gc_in_progress;
  AjisaiObjColor live_color;
} AjisaiMemManager;

int ajisai_mem_manager_init(AjisaiMemManager *manager);
void ajisai_mem_manager_deinit(AjisaiMemManager *manager);
void ajisai_mem_manager_append_to_to_space(AjisaiMemManager *manager, AjisaiMemCell *cell);

typedef enum {
  AJISAI_OBJ_STR,
  AJISAI_OBJ_STR_SLICE,
  AJISAI_OBJ_FUNC,
} AjisaiObjTag;

enum {
  AJISAI_HEAP_OBJ      = 0x80000000,
  AJISAI_BLACK_OBJ     = 0x40000000,
  AJISAI_GRAY_OBJ      = 0x20000000,
  AJISAI_OBJ_TAG_MASK  = 0x0000ffff,
};

typedef struct AjisaiObject AjisaiObject;

typedef struct {
  void (*scan_func)(AjisaiMemManager *, AjisaiObject *);
} AjisaiTypeInfo;

struct AjisaiObject {
  // 下位16bitをAjisaiObjTagの値として使う。上位16bitはメタデータのための領域とする
  uint32_t tag;
  AjisaiTypeInfo *type_info;
};

#define AJISAI_OBJ_TAG(obj) ((obj)->tag & AJISAI_OBJ_TAG_MASK)
#define AJISAI_IS_HEAP_OBJ(obj) ((obj)->tag & AJISAI_HEAP_OBJ)
#define AJISAI_IS_GRAY_OBJ(obj) ((obj)->tag & AJISAI_GRAY_OBJ)
#define AJISAI_IS_ALIVE_OBJ(obj, manager) ((manager)->live_color == AJISAI_BLACK ? ((obj)->tag & AJISAI_BLACK_OBJ) : !((obj)->tag & AJISAI_BLACK_OBJ))
#define AJISAI_OBJ_GET_OWNER_CELL(obj) ((AjisaiByteData *)((uint8_t *)(obj) - sizeof(AjisaiByteData)))->owner_cell

typedef struct AjisaiString AjisaiString;
struct AjisaiString {
  AjisaiObject obj_header;
  size_t len;
  char *value;
  AjisaiString *src;
};

typedef struct AjisaiClosure AjisaiClosure;
struct AjisaiClosure {
  AjisaiObject obj_header;
  void *func_ptr;
  void *captured_vars;
  void (*scan_func)(AjisaiMemManager *, AjisaiObject *);
};

typedef struct AjisaiFuncFrame AjisaiFuncFrame;
struct AjisaiFuncFrame {
  AjisaiFuncFrame *parent;
  AjisaiMemManager *mem_manager;
  size_t root_table_size;
  AjisaiObject **root_table;
};

AjisaiObject *ajisai_object_alloc(AjisaiFuncFrame *func_frame, size_t size);
void ajisai_gc_start(AjisaiFuncFrame *func_frame);

void ajisai_print_i32(AjisaiFuncFrame *func_frame, int32_t value);
void ajisai_println_i32(AjisaiFuncFrame *func_frame, int32_t value);
void ajisai_print_bool(AjisaiFuncFrame *func_frame, bool value);
void ajisai_println_bool(AjisaiFuncFrame *func_frame, bool value);
void ajisai_print(AjisaiFuncFrame *func_frame, AjisaiString *value);
void ajisai_println(AjisaiFuncFrame *func_frame, AjisaiString *value);
void ajisai_flush(AjisaiFuncFrame *func_frame);

AjisaiTypeInfo *ajisai_str_type_info(void);
AjisaiString *ajisai_str_concat(AjisaiFuncFrame *func_frame, AjisaiString *a, AjisaiString *b);
// TODO: 範囲指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_slice(AjisaiFuncFrame *func_frame, AjisaiString *src, int32_t start, int32_t end);
bool ajisai_str_equal(AjisaiFuncFrame *func_frame, AjisaiString *left, AjisaiString *right);
// TODO: 反復回数指定のための数値型は符号なし整数にする
AjisaiString *ajisai_str_repeat(AjisaiFuncFrame *func_frame, AjisaiString *src, int32_t count);
// TODO: 戻り値の型は符号なし整数にする
int32_t ajisai_str_len(AjisaiFuncFrame *func_frame, AjisaiString *s);

AjisaiTypeInfo *ajisai_func_type_info(void);
AjisaiClosure *ajisai_closure_new(AjisaiFuncFrame *func_frame, void *func_ptr, void (*scan_func)(AjisaiMemManager *, AjisaiObject *));
