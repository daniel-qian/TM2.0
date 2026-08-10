
### M-A — a card created by an append no longer records its birth batch

- 面：`py`
- 结果：**5 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_a_card_a_batch_created_records_the_batch_that_created_it[person]
FAILED tests/test_change_log_t85.py::test_a_card_a_batch_created_records_the_batch_that_created_it[project]
FAILED tests/test_change_log_t85.py::test_the_birth_batch_is_written_once_and_never_rewritten
FAILED tests/test_change_log_t85.py::test_the_real_append_chain_lands_the_birth_batch_on_the_stored_card
FAILED tests/test_change_log_t85.py::test_a_born_card_is_visible_without_any_provenance_at_all
```

### M-B — the birth batch is rewritten every time the card is touched again

- 面：`py`
- 结果：**ALL GREEN (pytest) <-- SURVIVED**

### M-C — being mentioned by a batch counts as being born in it

- 面：`py`
- 结果：**3 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_being_mentioned_by_a_batch_is_not_being_born_in_it[person]
FAILED tests/test_change_log_t85.py::test_being_mentioned_by_a_batch_is_not_being_born_in_it[project]
FAILED tests/test_change_log_t85.py::test_the_real_append_chain_lands_the_birth_batch_on_the_stored_card
```

### M-D — the person card stops projecting its lineage

- 面：`py`
- 结果：**4 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_the_card_carries_the_lineage_byte_for_byte[person]
FAILED tests/test_change_log_t85.py::test_no_person_number_can_ride_in_on_the_lineage
FAILED tests/test_change_log_t85.py::test_a_cell_only_the_first_upload_ever_wrote_stays_off_the_list
FAILED tests/test_change_log_t85.py::test_a_born_card_is_visible_without_any_provenance_at_all
```

### M-E — the project projection silently drops the prev chain (looks complete, is not)

- 面：`py`
- 结果：**3 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_the_card_carries_the_lineage_byte_for_byte[project]
FAILED tests/test_change_log_t85.py::test_an_overwritten_cell_carries_both_halves_of_from_x_to_y
FAILED tests/test_change_log_t85.py::test_a_hand_edited_cell_drops_off_the_list_but_keeps_its_prev
```

### M-F — the birth batch is stamped into provenance instead (the two side-cars blurred)

- 面：`py`
- 结果：**1 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_a_born_card_is_visible_without_any_provenance_at_all
```

### M-B — a person created by a form submission is logged as an upload change

- 面：`py`
- 结果：**1 FAIL (pytest)**

```
FAILED tests/test_change_log_t85.py::test_a_form_submission_creating_a_person_is_not_a_material_change
```

### M-G — the doc-origin gate is dropped (first-upload cells flood the trail)

- 面：`js`
- 结果：**32 PASS / 6 FAIL**

### M-H — status prints the normalized token instead of the word on the card

- 面：`js`
- 结果：**37 PASS / 1 FAIL**

### M-I — enrichment is reported as an overwrite (a prev value invented out of nothing)

- 面：`js`
- 结果：**7 PASS / 2 FAIL [CRASH mid-run: summary line never printed]**

```
  log: [ `  - waiting for locator('[data-files-zone="changes"]')` ],
  name: 'TimeoutError'
}

Node.js v24.13.0
```

### M-J — the row id forgets which document changed the cell

- 面：`js`
- 结果：**36 PASS / 2 FAIL**

### M-K — the clamp counts .length instead of display width (full-width weighs 1)

- 面：`js`
- 结果：**37 PASS / 1 FAIL**

### M-L — the rail count shows the total instead of what is still unread

- 面：`js`
- 结果：**37 PASS / 1 FAIL**

### M-M — read rows stay in the trail (marking one changes nothing on screen)

- 面：`js`
- 结果：**35 PASS / 3 FAIL**

### M-N — the citation jumps to the Documents zone without filtering to that file

- 面：`js`
- 结果：**36 PASS / 2 FAIL**

### M-I — every change is reported as an overwrite (the enrichment class disappears)

- 面：`js`
- 结果：**37 PASS / 1 FAIL**

### M-O — the citation goes back to the centred inline-flex (clipped at both ends)

- 面：`js`
- 结果：**39 PASS / 2 FAIL**
