#include "ajisai_runtime.h"

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

static AjisaiString *ajisai_str_new(ProcFrame *proc_frame, AjisaiObjTag tag, size_t len, char *str_data, AjisaiString *src) {
  AjisaiString *new_str = ajisai_malloc(proc_frame, sizeof(AjisaiString));
  new_str->obj_header.tag = tag;
  // TODO: collect_root_func を設定
  new_str->len = len;
  new_str->value = str_data;
  new_str->src = src;
  return new_str;
}

void ajisai_print_i32(int32_t value) {
  printf("%d", value);
}

void ajisai_println_i32(int32_t value) {
  ajisai_print_i32(value);
  putchar('\n');
}

void ajisai_print_bool(bool value) {
  printf("%s", value ? "true" : "false");
}

void ajisai_println_bool(bool value) {
  ajisai_print_bool(value);
  putchar('\n');
}

void ajisai_print_str(AjisaiString *value) {
  printf("%.*s", (int)value->len, value->value);
}

void ajisai_println_str(AjisaiString *value) {
  ajisai_print_str(value);
  putchar('\n');
}

void ajisai_flush(void) {
  fflush(stdout);
}

AjisaiString *ajisai_empty_str = &(AjisaiString){
  .obj_header = { .tag = AJISAI_OBJ_STR_STATIC }, .len = 0, .value = "" };

AjisaiString *ajisai_str_concat(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b) {
  char *new_str_data;
  size_t a_str_len, b_str_len, new_str_len;
  a_str_len = a->len;
  b_str_len = b->len;

  if (a_str_len == 0 && b_str_len == 0)
    return ajisai_empty_str;

  new_str_len = a_str_len + b_str_len;
  new_str_data = malloc(new_str_len + 1);

  memcpy(new_str_data, a->value, a_str_len);
  memcpy(new_str_data + a_str_len, b->value, b_str_len);
  new_str_data[new_str_len] = '\0';

  return ajisai_str_new(proc_frame, AJISAI_OBJ_STR_HEAP, new_str_len, new_str_data, NULL);
}

AjisaiString *ajisai_str_slice(ProcFrame *proc_frame, AjisaiString *src, int32_t start, int32_t end) {
  if (end - start == 0)
    return ajisai_empty_str;

  // TODO: Error 型および Result 型の導入時に Error を返すように変更する
  if (start > end) {
    fprintf(stderr, "error: end index is larger than start index\n");
    exit(1);
  }
  if (start >= src->len || end > src->len) {
    fprintf(stderr, "error: index is out of str bounds\n");
    exit(1);
  }

  return ajisai_str_new(proc_frame, AJISAI_OBJ_STR_SLICE, end - start, src->value + start, src);
}

bool ajisai_str_equal(AjisaiString *left, AjisaiString *right) {
  if (left->len != right->len)
    return false;
  return memcmp(left->value, right->value, left->len) == 0;
}

AjisaiString *ajisai_str_repeat(ProcFrame *proc_frame, AjisaiString *src, int32_t count) {
  if (count == 0)
    return ajisai_empty_str;

  size_t new_str_len = src->len * count;
  char *new_str_data = malloc(new_str_len + 1);

  for (int32_t i = 0; i < count; i++)
    memcpy(new_str_data + src->len * i, src->value, src->len);
  new_str_data[new_str_len] = '\0';

  return ajisai_str_new(proc_frame, AJISAI_OBJ_STR_HEAP, new_str_len, new_str_data, NULL);
}
