#include "ajisai_runtime.h"
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

static AjisaiMemCellBlock *ajisai_memcell_block_new(size_t memcell_cnt) {
  AjisaiMemCellBlock *block = malloc(sizeof(AjisaiMemCellBlock));
  if (block == NULL)
    return NULL;

  block->memcell_count = memcell_cnt;
  block->block = malloc(sizeof(AjisaiMemCell) * memcell_cnt);
  if (block->block == NULL)
    return NULL;

  block->memcell_next_idx = 0;

  return block;
}

static void ajisai_memcell_block_delete(AjisaiMemCellBlock *block) {
  free(block->block);
  free(block);
}

static void ajisai_memcell_allocator_deinit(AjisaiMemCellAllocator *allocator);

static int ajisai_memcell_allocator_add_block(AjisaiMemCellAllocator *allocator) {
  AjisaiMemCellBlock *new_block = ajisai_memcell_block_new(AJISAI_BLOCKS_MEMCELL_COUNT);
  if (new_block == NULL) {
    ajisai_memcell_allocator_deinit(allocator);
    return 1;
  }
  new_block->next = allocator->blocks;
  allocator->blocks = new_block;
  return 0;
}

static int ajisai_memcell_allocator_init(AjisaiMemCellAllocator *allocator) {
  allocator->blocks = NULL;
  if (ajisai_memcell_allocator_add_block(allocator))
    return 1;
  return 0;
}

static void ajisai_memcell_allocator_deinit(AjisaiMemCellAllocator *allocator) {
  while (allocator->blocks != NULL) {
    AjisaiMemCellBlock *next = allocator->blocks->next;
    ajisai_memcell_block_delete(allocator->blocks);
    allocator->blocks = next;
  }
}

static AjisaiMemCell *ajisai_memcell_allocator_alloc(AjisaiMemCellAllocator *allocator) {
  size_t memcell_count = allocator->blocks->memcell_count;
  size_t memcell_next_idx = allocator->blocks->memcell_next_idx;
  if (memcell_next_idx >= memcell_count) {
    if (ajisai_memcell_allocator_add_block(allocator))
      return NULL;
  }
  return &allocator->blocks->block[allocator->blocks->memcell_next_idx++];
}

static int ajisai_free_memcells_init(AjisaiFreeMemCells *free_memcells, AjisaiMemCellAllocator *allocator) {
  AjisaiMemCell *bottom_cell = ajisai_memcell_allocator_alloc(allocator);
  if (bottom_cell == NULL)
    return 1;
  bottom_cell->size = 0;
  bottom_cell->data = NULL;

  free_memcells->bottom = bottom_cell;
  free_memcells->memcells = NULL;
  return 0;
}

static AjisaiMemCell *ajisai_free_memcells_pop_memcell(AjisaiFreeMemCells *free_memcells, size_t size) {
  AjisaiMemCell *prev;
  for (AjisaiMemCell *cell = free_memcells->memcells; cell != NULL; cell = cell->next) {
    if (cell->size == size) {
      if (cell == free_memcells->memcells)
        free_memcells->memcells = cell->next;
      else
        prev->next = cell->next;
      return cell;
    }
    prev = cell;
  }
  return NULL;
}

static void ajisai_free_memcells_add_memcell(AjisaiFreeMemCells *free_memcells, AjisaiMemCell *cell) {
  cell->next = free_memcells->memcells;
  free_memcells->memcells = cell;
}

int ajisai_mem_manager_init(AjisaiMemManager *manager) {
  if (ajisai_memcell_allocator_init(&manager->memcell_allocator)
      || ajisai_free_memcells_init(&manager->free, &manager->memcell_allocator))
    return 1;

  manager->free.bottom->next = &manager->free.new_edge;
  manager->free.new_edge.prev = manager->free.bottom;

  manager->top = manager->scan = manager->free.bottom;

  return 0;
}

void ajisai_mem_manager_deinit(AjisaiMemManager *manager) {
  AjisaiMemCellBlock *blocks = manager->memcell_allocator.blocks;
  for (AjisaiMemCellBlock *block = blocks; block != NULL; block = block->next) {
    for (size_t i = 0; i < block->memcell_next_idx; i++) {
      AjisaiMemCell *cell = &block->block[i];
      if (cell != manager->free.bottom && cell->data != NULL) {
        // TODO: ここはオブジェクトのタイプごとに解放処理を分岐しなければならない
        free(cell->data);
      }
    }
  }
  ajisai_memcell_allocator_deinit(&manager->memcell_allocator);
}

void *ajisai_malloc(ProcFrame *proc_frame, size_t size) {
  AjisaiMemManager *mem_manager = proc_frame->mem_manager;

  AjisaiMemCell *bottom = mem_manager->free.bottom;
  // cell 変数が指す MemCell は Free 空間の From 空間側の末端として使用する
  // 現在 bottom が指している MemCell の方が From 空間に加わる
  AjisaiMemCell *cell = ajisai_free_memcells_pop_memcell(&mem_manager->free, size);
  if (cell == NULL) {
    // TODO: 確保済みメモリ領域のサイズが何らかの閾値を超えると GC が走るようにする
    cell = ajisai_memcell_allocator_alloc(&mem_manager->memcell_allocator);
    if (cell == NULL)
      return NULL;

    cell->size = sizeof(AjisaiByteData) + size;
    cell->data = malloc(cell->size);
    if (cell->data == NULL)
      return NULL;
    cell->data->owner_cell = cell;
  }

  // bottom セルの手前に新しい cell を接続
  bottom->prev = cell;
  cell->next = bottom;

  // 新しい cell のデータを bottom セルにコピー
  bottom->data = cell->data;
  bottom->size = cell->size;

  // bottom が新しい cell を指すように更新する
  // 初期状態では top は 前の bottom が指していた cell の方を指し続けているため、
  // From 空間が拡大する
  mem_manager->free.bottom = cell;

  // cell は今提供しようとしている有効なバイトデータをまだ保持しているので
  // これを戻り値として返す。メタデータの部分は取り除いている
  return (void *)cell->data->data;
}

static AjisaiString *ajisai_string_new(ProcFrame *proc_frame, char *str_data) {
  AjisaiString *new_str = ajisai_malloc(proc_frame, sizeof(AjisaiString));
  new_str->value = str_data;
  return new_str;
}

void ajisai_println_i32(int32_t value) {
  printf("%d\n", value);
}

void ajisai_println_bool(bool value) {
  printf("%s\n", value ? "true" : "false");
}

void ajisai_println_str(AjisaiString *value) {
  printf("%s\n", value->value);
}

AjisaiString *ajisai_concat_str(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b) {
  size_t a_str_size, b_str_size;
  a_str_size = strlen(a->value);
  b_str_size = strlen(b->value);

  size_t new_data_size = a_str_size + b_str_size + 1;
  char *new_str_data = malloc(new_data_size);

  strcpy(new_str_data, a->value);
  strcpy(new_str_data + a_str_size, b->value);
  return ajisai_string_new(proc_frame, new_str_data);
}
