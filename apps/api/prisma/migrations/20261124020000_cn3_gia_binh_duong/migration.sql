-- Theo chủ đầu tư (24/11/2026): CN1, CN2 (Bình Phước) dùng giá BP; CN3 Mỹ Phước (Bình Dương) dùng giá BD.
-- Chỉ đổi chi nhánh CN3 có tên "Mỹ Phước"; chi nhánh khác giữ mặc định BP, chỉnh tiếp trong Cài đặt → Chi nhánh.
UPDATE "branches" SET "price_zone" = 'BD' WHERE "code" = 'CN3' AND "name" ILIKE '%Mỹ Phước%' AND "deleted_at" IS NULL;
