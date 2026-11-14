-- 제품등록: 품목 분류(원자재/부자재/반제품/제품/상품)별 1차·2차·3차 세부 분류를 미리 만들어 두고 선택한다.
-- 반제품 분류에는 커팅/융착·세탁에서 쓰는 생산 종류(semi_type)를 지정할 수 있다(하위 분류는 상위 값을 물려받음).
CREATE TABLE item_category_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_class TEXT NOT NULL CHECK(item_class IN ('원자재','부자재','반제품','제품','상품')),
  parent_id INTEGER REFERENCES item_category_nodes(id),
  level INTEGER NOT NULL CHECK(level IN (1,2,3)),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 50),
  semi_type TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE UNIQUE INDEX item_category_nodes_unique ON item_category_nodes(item_class, COALESCE(parent_id,0), name);
CREATE INDEX item_category_nodes_parent ON item_category_nodes(parent_id);
-- Values already used on items become selectable nodes, so existing items keep valid categories. Items are not changed.
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,created_by)
  SELECT DISTINCT item_category,NULL,1,cat1,'기존 품목' FROM boms WHERE item_category IN ('원자재','부자재','반제품','제품','상품') AND cat1<>'';
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,created_by)
  SELECT DISTINCT b.item_category,n.id,2,b.cat2,'기존 품목' FROM boms b JOIN item_category_nodes n ON n.item_class=b.item_category AND n.level=1 AND n.name=b.cat1 WHERE b.cat2<>'';
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,created_by)
  SELECT DISTINCT b.item_category,c.id,3,b.cat3,'기존 품목' FROM boms b JOIN item_category_nodes p ON p.item_class=b.item_category AND p.level=1 AND p.name=b.cat1
  JOIN item_category_nodes c ON c.parent_id=p.id AND c.level=2 AND c.name=b.cat2 WHERE b.cat3<>'';
-- Production kinds the cutting/washing screens already know.
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,created_by) VALUES('반제품',NULL,1,'와이퍼','기본'),('반제품',NULL,1,'심리스글러브','기본');
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,semi_type,created_by)
  SELECT '반제품',id,2,'부직포와이퍼','부직포와이퍼','기본' FROM item_category_nodes WHERE item_class='반제품' AND level=1 AND name='와이퍼';
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,semi_type,created_by)
  SELECT '반제품',id,2,'천와이퍼','천와이퍼','기본' FROM item_category_nodes WHERE item_class='반제품' AND level=1 AND name='와이퍼';
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,semi_type,created_by)
  SELECT '반제품',id,2,'스무드','스무드','기본' FROM item_category_nodes WHERE item_class='반제품' AND level=1 AND name='심리스글러브';
INSERT OR IGNORE INTO item_category_nodes(item_class,parent_id,level,name,semi_type,created_by)
  SELECT '반제품',id,2,'타키','타키','기본' FROM item_category_nodes WHERE item_class='반제품' AND level=1 AND name='심리스글러브';
-- Seeded or migrated 반제품 nodes whose name is a known kind get that kind (nothing else is guessed).
UPDATE item_category_nodes SET semi_type=name WHERE item_class='반제품' AND semi_type='' AND name IN ('부직포와이퍼','천와이퍼','스무드','타키');
