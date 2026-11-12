-- app_config holds the backend address. Only the server (service key) reads or writes it.
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
