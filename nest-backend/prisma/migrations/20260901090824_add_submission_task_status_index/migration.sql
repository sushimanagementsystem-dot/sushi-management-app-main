-- CreateIndex
CREATE INDEX "submission_kiosk_id_form_type_business_date_idx" ON "submission"("kiosk_id", "form_type", "business_date");
