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

typedef struct {
  char *value;
} AjisaiString;

void ajisai_println_i32(int32_t value);
void ajisai_println_bool(bool value);
void ajisai_println_str(AjisaiString *value);
AjisaiString *ajisai_concat_str(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b);
