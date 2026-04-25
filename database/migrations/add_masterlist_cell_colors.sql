-- Migration: add_masterlist_cell_colors
-- Per-cell highlight colours for the Invoice No. and Payment Mode columns in the
-- master list view. Values are the string keys '', 'red', 'yellow', 'green'.

ALTER TABLE public.masterlist_table
  ADD COLUMN IF NOT EXISTS invoice_no_color   text;

ALTER TABLE public.masterlist_table
  ADD COLUMN IF NOT EXISTS payment_mode_color text;
