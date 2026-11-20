-- 15.267 거래처 상세: 시스템 거래처명과 세금계산서 사업자상호(biz_name)를 나눠 쓰고, 영문명·법인번호·대표전화·팩스·주소·홈페이지·메모,
-- 계산서 담당자(이름·부서·전화), 거래 담당자(직위·휴대전화·이메일), 결제 계좌(은행·계좌·예금주)를 따로 저장한다.
ALTER TABLE vendors ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN corp_no TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN tel TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN fax TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN addr TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN homepage TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN memo TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN tax_contact TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN tax_dept TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN tax_phone TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN contact_title TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN contact_mobile TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN bank_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN bank_account TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN bank_holder TEXT NOT NULL DEFAULT '';
