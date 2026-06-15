delete from public.loans
where (borrower = 'Juan Perez' and phone = '3001234567' and amount = 500000)
   or (borrower = 'Ana Gomez' and phone = '3007654321' and amount = 300000)
   or (borrower = 'Luis Diaz' and phone = '3011122233' and amount = 800000)
   or (borrower = 'Maria Lopez' and phone = '3022233344' and amount = 400000)
   or (borrower = 'Carlos Ruiz' and phone = '3033344455' and amount = 600000);
