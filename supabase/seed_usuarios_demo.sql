-- =============================================================================
-- Usuarios de demostración — SOLO entorno local (supabase start / db reset)
-- Contraseña de todos: Sombreros#2026   (MFA se enrola en el primer login)
-- En producción los usuarios se crean desde el ERP con la Admin API.
-- =============================================================================

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'propietario@sombreros.test', 'Propietario Demo', 'superadmin', null),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'gerente.lpz@sombreros.test', 'Gerente La Paz',   'gerente',    'LPZ'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'cajero.lpz@sombreros.test',  'Cajero La Paz',    'cajero',     'LPZ'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'gerente.cbb@sombreros.test', 'Gerente Cochabamba', 'gerente',  'CBB'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'cajero.scz@sombreros.test',  'Cajero Santa Cruz', 'cajero',    'SCZ'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'taller@sombreros.test',      'Encargado Taller', 'almacen',    'TAL')
    ) as t(id, email, nombre, rol, sucursal)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Sombreros#2026', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'rol', u.rol,
                         'sucursal_id', (select id from public.sucursales where codigo = u.sucursal)),
      jsonb_build_object('nombre_completo', u.nombre), now(), now(), '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now());
  end loop;
end;
$$;
