CREATE POLICY "Users update their own certificates"
ON public.certificates
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);