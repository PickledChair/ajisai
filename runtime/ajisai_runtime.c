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

static AjisaiMemCell *ajisai_memcell_allocator_alloc(AjisaiMemCellAllocator *allocator, bool *allocate_block) {
  size_t memcell_count = allocator->blocks->memcell_count;
  size_t memcell_next_idx = allocator->blocks->memcell_next_idx;

  if (allocate_block)
    *allocate_block = false;

  if (memcell_next_idx >= memcell_count) {
    if (ajisai_memcell_allocator_add_block(allocator)) {
      return NULL;
    } else {
      if (allocate_block)
        *allocate_block = true;
    }

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
    printf("[MEMORY MANAGER DEBUG] add block at memcell allocator\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  }
  return &allocator->blocks->block[allocator->blocks->memcell_next_idx++];
}

static int ajisai_free_memcells_init(AjisaiFreeMemCells *free_memcells, AjisaiMemCellAllocator *allocator) {
  AjisaiMemCell *bottom_cell = ajisai_memcell_allocator_alloc(allocator, NULL);
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
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
    printf("[MEMORY MANAGER DEBUG] \tfound free memcell's size: %zu (%zu required)\n", cell->size, size);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

    if (cell->size == size) {
      if (cell == free_memcells->memcells) {
        free_memcells->memcells = cell->next;
      } else {
        prev->next = cell->next;
      }
      cell->next = cell->prev = NULL;
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

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
static void ajisai_mem_manager_display_stat(AjisaiMemManager *manager);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

int ajisai_mem_manager_init(AjisaiMemManager *manager) {
  if (ajisai_memcell_allocator_init(&manager->memcell_allocator)
      || ajisai_free_memcells_init(&manager->free, &manager->memcell_allocator))
    return 1;

  manager->free.bottom->next = &manager->free.new_edge;
  manager->free.new_edge.prev = manager->free.bottom;

  manager->top = manager->scan = manager->free.bottom;

  manager->gc_in_progress = false;
  manager->live_color = AJISAI_WHITE;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  ajisai_mem_manager_display_stat(manager);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  return 0;
}

void ajisai_str_heap_free(AjisaiObject *obj);
void ajisai_closure_heap_free(AjisaiObject *obj);

static void ajisai_object_heap_free(AjisaiObject *obj) {
  switch (AJISAI_OBJ_TAG(obj)) {
    case AJISAI_OBJ_STR:
      if (AJISAI_IS_HEAP_OBJ(obj))
        ajisai_str_heap_free(obj);
      break;
    case AJISAI_OBJ_PROC:
      ajisai_closure_heap_free(obj);
      break;
    default:
      break;
  }
}

void ajisai_mem_manager_deinit(AjisaiMemManager *manager) {
  AjisaiMemCellBlock *blocks = manager->memcell_allocator.blocks;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] mem_manager_deinit start\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  for (AjisaiMemCellBlock *block = blocks; block != NULL; block = block->next) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
    printf("[MEMORY MANAGER DEBUG] \tblock %p, block size %zu (* %lu)\n", block, block->memcell_next_idx, sizeof(AjisaiMemCell));
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

    for (size_t i = 0; i < block->memcell_next_idx; i++) {
      AjisaiMemCell *cell = &block->block[i];
      if (cell != manager->free.bottom && cell->data != NULL) {
        AjisaiObject *obj = (AjisaiObject *)cell->data->data;
        ajisai_object_heap_free(obj);
        free(cell->data);
      }
    }
  }
  ajisai_memcell_allocator_deinit(&manager->memcell_allocator);

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] mem_manager_deinit end\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
static void ajisai_mem_manager_display_stat(AjisaiMemManager *manager) {
  size_t free_cnt = 0, new_cnt = 0, to_cnt = 0, from_cnt = 0;

  for (AjisaiMemCell *cell = manager->free.memcells; cell != NULL; cell = cell->next) free_cnt++;
  for (AjisaiMemCell *cell = manager->free.new_edge.prev; cell != manager->scan; cell = cell->prev) {
    if (cell == manager->free.bottom)
      break;
    new_cnt++;
  }
  for (AjisaiMemCell *cell = manager->scan; cell != manager->top; cell = cell->prev) {
    if (cell == manager->free.bottom)
      break;
    to_cnt++;
  }
  if (manager->top != manager->free.bottom) {
    for (AjisaiMemCell *cell = manager->top; cell != manager->free.bottom; cell = cell->prev) {
      from_cnt++;
    }
  }

  printf("[MEMORY MANAGER DEBUG] treadmill stat: free %zu, new %zu, to %zu, from %zu\n", free_cnt, new_cnt, to_cnt, from_cnt);
}
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

static void ajisai_mem_manager_append_to_new_space(AjisaiMemManager *manager, AjisaiMemCell *cell) {
  cell->prev = manager->free.new_edge.prev;
  manager->free.new_edge.prev->next = cell;

  manager->free.new_edge.prev = cell;
  cell->next = &manager->free.new_edge;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] grow new-space\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

// NOTE: この関数によって cell の持つデータへのポインタは直前まで bottom が指していた MemCell にコピーされる
static void ajisai_mem_manager_append_to_from_space(AjisaiMemManager *manager, AjisaiMemCell *cell) {
  // bottom セルの手前に新しい cell を接続
  manager->free.bottom->prev = cell;
  cell->next = manager->free.bottom;
  cell->prev = NULL;

  // 新しい cell のデータを bottom セルにコピー
  manager->free.bottom->data = cell->data;
  manager->free.bottom->data->owner_cell = manager->free.bottom;
  manager->free.bottom->size = cell->size;

  // bottom が新しい cell を指すように更新する
  // 初期状態では top は 前の bottom が指していた cell の方を指し続けているため、
  // From 空間が拡大する
  manager->free.bottom = cell;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  assert(cell != NULL);
  assert(manager->free.bottom != manager->top);
  assert(manager->free.bottom != manager->scan);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

void ajisai_mem_manager_append_to_to_space(AjisaiMemManager *manager, AjisaiMemCell *cell) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  AjisaiMemCell *prev_scan = manager->scan;
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  if (cell == manager->scan)
    return;
  // scan セルの次のセルの直前に cell を接続
  manager->scan->next->prev = cell;
  cell->next = manager->scan->next;

  // scan セルを cell の直後に接続
  cell->prev = manager->scan;
  manager->scan->next = cell;

  // scan ポインタを cell を指すように更新
  manager->scan = cell;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  assert(cell != NULL);
  assert(manager->scan != prev_scan);
  assert(manager->scan != manager->top);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

static void ajisai_object_mark_alive(AjisaiObject *obj, AjisaiMemManager *mem_manager) {
  if (mem_manager->live_color == AJISAI_WHITE)
    obj->tag &= ~AJISAI_BLACK_OBJ;
  else
    obj->tag |= AJISAI_BLACK_OBJ;
}

// NOTE: scan が終了状態の時は何も行わず 1 を返す
static int ajisai_mem_manager_scan_obj_tree(AjisaiMemManager *manager) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] scan_obj_tree ...\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  if (manager->scan == manager->top) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] scan_obj_tree finished\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

    return 1;
  }

  AjisaiObject *obj = (AjisaiObject *)manager->scan->data->data;

  // GRAYビットが立っているオブジェクトがスキャン対象
  if (AJISAI_IS_GRAY_OBJ(obj)) {
    // スキャンを実行
    obj->type_info->scan_func(manager, obj);
    // スキャン済みのマークをする
    obj->tag &= ~AJISAI_GRAY_OBJ;
    ajisai_object_mark_alive(obj, manager);
  }
  // スキャンポインタを次に進める
  manager->scan = manager->scan->prev;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] scan_obj_tree continue\n");
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  return 0;
}

static void ajisai_mem_manager_release_from_space(AjisaiMemManager *manager) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  assert(manager->scan == manager->top);
  printf("[MEMORY MANAGER DEBUG] release_from_space start\n");
  int released_cell_count = 0;
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  while (manager->top != manager->free.bottom) {
    AjisaiMemCell *released = manager->top;
    manager->top = manager->top->prev;

    AJISAI_MEMCELL_POP_OWN(manager, released);

    AjisaiObject *obj = (AjisaiObject *)released->data->data;
    ajisai_object_heap_free(obj);

    released->next = manager->free.memcells;
    manager->free.memcells = released;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
    released_cell_count++;
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  }

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] release_from_space end (%d cells released)\n", released_cell_count);
  size_t freecells_cnt = 0;
  for (AjisaiMemCell *cell = manager->free.memcells; cell != NULL; cell = cell->next) freecells_cnt++;
  printf("[MEMORY MANAGER DEBUG] free_memcells count: %zu\n", freecells_cnt);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

static void ajisai_proc_frame_scan_roots(ProcFrame *proc_frame) {
  AjisaiMemManager *manager = proc_frame->mem_manager;

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] scan_roots start\n");
  int scanned_cell_count = 0;
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  for (ProcFrame *frame = proc_frame; frame != NULL; frame = frame->parent) {
#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
    printf("[MEMORY MANAGER DEBUG] \tscanning frame %p ...\n", frame);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

    for (size_t i = 0; i < frame->root_table_size; i++) {
      AjisaiObject *obj = frame->root_table[i];
      if (obj != NULL && AJISAI_IS_HEAP_OBJ(obj) && !AJISAI_IS_GRAY_OBJ(obj)) {
        AjisaiMemCell *cell = AJISAI_OBJ_GET_OWNER_CELL(obj);
        AJISAI_MEMCELL_POP_OWN(manager, cell);
        // スキャン中のフラグ (AJISAI_GRAY_OBJ) を立てる
        obj->tag |= AJISAI_GRAY_OBJ;
        ajisai_mem_manager_append_to_to_space(manager, cell);

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
        scanned_cell_count++;
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
      }
    }
  }

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  printf("[MEMORY MANAGER DEBUG] scan_roots end (%d cells going to to-space)\n", scanned_cell_count);
  ajisai_mem_manager_display_stat(manager);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
}

AjisaiObject *ajisai_object_alloc(ProcFrame *proc_frame, size_t size) {
  AjisaiMemManager *mem_manager = proc_frame->mem_manager;
  AjisaiMemCell *cell = ajisai_free_memcells_pop_memcell(&mem_manager->free, size);

  if (cell == NULL) {
    bool allocate_block;
    cell = ajisai_memcell_allocator_alloc(&mem_manager->memcell_allocator, &allocate_block);
    if (cell == NULL)
      return NULL;

    if (allocate_block && !mem_manager->gc_in_progress) {
      mem_manager->gc_in_progress = true;

      // 生きているオブジェクトの色を反転させることで、全てのオブジェクトの生存フラグを外す
      if (mem_manager->live_color == AJISAI_WHITE)
        mem_manager->live_color = AJISAI_BLACK;
      else
        mem_manager->live_color = AJISAI_WHITE;

      ajisai_proc_frame_scan_roots(proc_frame);
    }

    cell->size = size;
    cell->data = malloc(sizeof(AjisaiByteData) + cell->size);
    if (cell->data == NULL)
      return NULL;
    cell->data->owner_cell = cell;
  }

  if (mem_manager->gc_in_progress && ajisai_mem_manager_scan_obj_tree(mem_manager) == 0) {
    ajisai_mem_manager_append_to_new_space(mem_manager, cell);
  } else {
    if (mem_manager->gc_in_progress) {
      ajisai_mem_manager_release_from_space(mem_manager);
      mem_manager->top = mem_manager->scan = mem_manager->free.new_edge.prev;
      mem_manager->gc_in_progress = false;
    }
    // NOTE: 以下の関数によって cell の持つデータへのポインタは直前まで bottom が指していた
    //       MemCell にコピーされる。
    //       cell 変数が指す MemCell は Free 空間の From 空間側の末端として使用する
    //       現在 bottom が指している MemCell の方が From 空間に加わる
    ajisai_mem_manager_append_to_from_space(mem_manager, cell);
    // cell は今提供しようとしている有効なバイトデータをまだ保持しているので
    // これの指すデータを戻り値として返す。メタデータの部分は取り除いている
  }

#ifdef AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT
  ajisai_mem_manager_display_stat(mem_manager);
#endif // AJISAI_MEMORY_MANAGER_DEBUG_OUTPUT

  return (AjisaiObject *)cell->data->data;
}

void ajisai_gc_start(ProcFrame *proc_frame) {
  AjisaiMemManager *mem_manager = proc_frame->mem_manager;

  if (!mem_manager->gc_in_progress) {
    mem_manager->gc_in_progress = true;
    ajisai_proc_frame_scan_roots(proc_frame);
  }
  while (ajisai_mem_manager_scan_obj_tree(mem_manager) == 0);
  ajisai_mem_manager_release_from_space(mem_manager);
  mem_manager->top = mem_manager->scan = mem_manager->free.new_edge.prev;
  mem_manager->gc_in_progress = false;
}

void ajisai_print_i32(ProcFrame *proc_frame, int32_t value) {
  printf("%d", value);
}

void ajisai_println_i32(ProcFrame *proc_frame, int32_t value) {
  ajisai_print_i32(proc_frame, value);
  putchar('\n');
}

void ajisai_print_bool(ProcFrame *proc_frame, bool value) {
  printf("%s", value ? "true" : "false");
}

void ajisai_println_bool(ProcFrame *proc_frame, bool value) {
  ajisai_print_bool(proc_frame, value);
  putchar('\n');
}

void ajisai_print_str(ProcFrame *proc_frame, AjisaiString *value) {
  printf("%.*s", (int)value->len, value->value);
}

void ajisai_println_str(ProcFrame *proc_frame, AjisaiString *value) {
  ajisai_print_str(proc_frame, value);
  putchar('\n');
}

void ajisai_flush(ProcFrame *proc_frame) {
  fflush(stdout);
}

static void ajisai_str_scan_func(AjisaiMemManager *mem_manager, AjisaiObject *obj) {
  AjisaiString *str = (AjisaiString *)obj;
  if (AJISAI_OBJ_TAG(&str->obj_header) == AJISAI_OBJ_STR_SLICE) {
    AjisaiMemCell *cell = AJISAI_OBJ_GET_OWNER_CELL((AjisaiObject *)str->src);
    if (!AJISAI_IS_GRAY_OBJ((AjisaiObject *)str->src) && !AJISAI_IS_ALIVE_OBJ((AjisaiObject *)str->src, mem_manager)) {
      AJISAI_MEMCELL_POP_OWN(mem_manager, cell);
      // 今後のスキャン対象としてマーク
      ((AjisaiObject *)str->src)->tag |= AJISAI_GRAY_OBJ;
      ajisai_mem_manager_append_to_to_space(mem_manager, cell);
    }
  }
}

AjisaiTypeInfo *ajisai_str_type_info(void) {
  static AjisaiTypeInfo ajisai_str_type_info_ = {};
  if (ajisai_str_type_info_.scan_func != NULL)
    return &ajisai_str_type_info_;

  ajisai_str_type_info_.scan_func = ajisai_str_scan_func;
  return &ajisai_str_type_info_;
}

static AjisaiString *ajisai_empty_str(void) {
  static AjisaiString ajisai_empty_str_ =
    { .obj_header = { .tag = AJISAI_OBJ_STR }, .len = 0, .value = "" };
  if (ajisai_empty_str_.obj_header.type_info != NULL)
    return &ajisai_empty_str_;

  ajisai_empty_str_.obj_header.type_info = ajisai_str_type_info();
  return &ajisai_empty_str_;
}

static AjisaiString *ajisai_str_new(
  ProcFrame *proc_frame, AjisaiObjTag tag, size_t len, char *str_data, AjisaiString *src) {
  if (len == 0)
    return ajisai_empty_str();

  AjisaiString *new_str = (AjisaiString *)ajisai_object_alloc(proc_frame, sizeof(AjisaiString));
  new_str->obj_header.tag = tag | AJISAI_HEAP_OBJ;
  new_str->obj_header.type_info = ajisai_str_type_info();
  new_str->len = len;
  new_str->value = str_data;
  new_str->src = src;
  return new_str;
}

void ajisai_str_heap_free(AjisaiObject *obj) {
  AjisaiString *str = (AjisaiString *)obj;
  if (str->value) {
    free(str->value);
    str->value = NULL;
  }
}

AjisaiString *ajisai_str_concat(ProcFrame *proc_frame, AjisaiString *a, AjisaiString *b) {
  char *new_str_data;
  size_t a_str_len, b_str_len, new_str_len;
  a_str_len = a->len;
  b_str_len = b->len;

  if (a_str_len == 0 && b_str_len == 0)
    return ajisai_empty_str();

  new_str_len = a_str_len + b_str_len;
  new_str_data = malloc(new_str_len + 1);

  memcpy(new_str_data, a->value, a_str_len);
  memcpy(new_str_data + a_str_len, b->value, b_str_len);
  new_str_data[new_str_len] = '\0';

  return ajisai_str_new(proc_frame, AJISAI_OBJ_STR, new_str_len, new_str_data, NULL);
}

AjisaiString *ajisai_str_slice(ProcFrame *proc_frame, AjisaiString *src, int32_t start, int32_t end) {
  if (end - start == 0)
    return ajisai_empty_str();
  if (start == 0 && end == src->len)
    return src;

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

bool ajisai_str_equal(ProcFrame *proc_frame, AjisaiString *left, AjisaiString *right) {
  if (left->len != right->len)
    return false;
  return memcmp(left->value, right->value, left->len) == 0;
}

AjisaiString *ajisai_str_repeat(ProcFrame *proc_frame, AjisaiString *src, int32_t count) {
  if (count == 0)
    return ajisai_empty_str();

  size_t new_str_len = src->len * count;
  char *new_str_data = malloc(new_str_len + 1);

  for (int32_t i = 0; i < count; i++)
    memcpy(new_str_data + src->len * i, src->value, src->len);
  new_str_data[new_str_len] = '\0';

  return ajisai_str_new(proc_frame, AJISAI_OBJ_STR, new_str_len, new_str_data, NULL);
}

static void ajisai_proc_scan_func(AjisaiMemManager *mem_manager, AjisaiObject *obj) {
  AjisaiClosure *cls = (AjisaiClosure *)obj;
  if (cls->scan_func)
    cls->scan_func(mem_manager, obj);
}

AjisaiTypeInfo *ajisai_proc_type_info(void) {
  static AjisaiTypeInfo ajisai_proc_type_info_ = {};
  if (ajisai_proc_type_info_.scan_func != NULL)
    return &ajisai_proc_type_info_;

  ajisai_proc_type_info_.scan_func = ajisai_proc_scan_func;
  return &ajisai_proc_type_info_;
}

AjisaiClosure *ajisai_closure_new(
    ProcFrame *proc_frame, void *func_ptr, void (*scan_func)(AjisaiMemManager *, AjisaiObject *)) {
  AjisaiClosure *new_closure = (AjisaiClosure *)ajisai_object_alloc(proc_frame, sizeof(AjisaiClosure));
  new_closure->obj_header.tag = AJISAI_OBJ_PROC | AJISAI_HEAP_OBJ;
  new_closure->obj_header.type_info = ajisai_proc_type_info();
  new_closure->func_ptr = func_ptr;
  new_closure->captured_vars = NULL;
  new_closure->scan_func = scan_func;
  return new_closure;
}

void ajisai_closure_heap_free(AjisaiObject *obj) {
  AjisaiClosure *cls = (AjisaiClosure *)obj;
  if (cls->captured_vars) {
    free(cls->captured_vars);
    cls->captured_vars = NULL;
  }
}
