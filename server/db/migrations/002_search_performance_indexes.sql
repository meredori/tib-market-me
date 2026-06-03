CREATE INDEX IF NOT EXISTS idx_market_item_prices_run_model_client_value
  ON market_item_prices (run_id, pricing_model, client_value DESC, item_id);
