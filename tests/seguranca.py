"""Teste de segurança: dados maliciosos vindos da nuvem não podem rodar código no app.

Como rodar (na pasta do repositório):
  1. pip install playwright pillow && playwright install chromium
  2. Em outro terminal, sirva o app em modo local:
       python3 -m http.server 8766
     (com firebase-config.js = null, para não mexer nos dados da nuvem)
  3. python3 tests/seguranca.py
"""
import os, tempfile
URL = os.environ.get('APP_URL', 'http://localhost:8766/')
import asyncio
from playwright.async_api import async_playwright
async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={'width':390,'height':844})
        await pg.add_init_script("""window.__xss=0;
          localStorage.setItem('p3d-pecas',JSON.stringify([{id:'a" onmouseover="x',nome:'Teste',who:'Davi',preco:5,custo:2,vendidas:'<img src=x onerror=window.__xss++>',criada:1,
            foto:'x" onerror="window.__xss++',ultimaVenda:{qtd:'<img src=x onerror=window.__xss++>',preco:5,custo:2}}]));
          localStorage.setItem('p3d-pedidos',JSON.stringify([{id:'p1',status:'aguardando',criada:1,cliente:'A',fone:'',prazo:3,itens:[{pecaId:'z',nome:'X',preco:1,custo:0,qtd:'<img src=x onerror=window.__xss++>'}]}]))""")
        await pg.goto(URL); await pg.wait_for_timeout(500)
        await pg.click('#tabs a[data-v="pecas"]'); await pg.wait_for_timeout(500)
        await pg.click('#tabs a[data-v="pedidos"]'); await pg.wait_for_timeout(500)
        q = await pg.evaluate('window.__xss')
        print('códigos injetados que rodaram:', q, '(OK)' if q == 0 else '(FALHA DE SEGURANÇA)')
        await b.close()
asyncio.run(m())
