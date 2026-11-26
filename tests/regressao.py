"""Teste completo do app: calculadora, lápis, vendas, pedidos, telefone, foto e PIN.

Como rodar (na pasta do repositório):
  1. pip install playwright pillow && playwright install chromium
  2. Em outro terminal, sirva o app em modo local:
       python3 -m http.server 8766
     (com firebase-config.js = null, para não mexer nos dados da nuvem)
  3. python3 tests/regressao.py
"""
import os, tempfile
URL = os.environ.get('APP_URL', 'http://localhost:8766/')
import asyncio, urllib.parse
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
FOTO = os.path.join(tempfile.gettempdir(), 'teste-foto.jpg')
im = Image.new('RGB', (3000, 4000), '#e9e4dc'); ImageDraw.Draw(im).rounded_rectangle([700, 1300, 2300, 2700], radius=300, fill='#ff6a00'); im.save(FOTO, quality=92)
ok=[];falhas=[]
def check(n,c,x=''): (ok if c else falhas).append(n+('' if c else f' -> {x}'))
R=lambda v:'R$\xa0'+f'{v:.2f}'.replace('.',',')
async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.add_init_script("window.__o=[];window.open=u=>window.__o.push(u)")
        await pg.goto(URL); await pg.wait_for_timeout(500)
        async def money(sel,v):
            await pg.tap(sel)
            for _ in range(8): await pg.keyboard.press('Backspace')
            await pg.keyboard.type(v); await pg.wait_for_timeout(80)
        # --- calculadora
        check('abre limpo', await pg.text_content('#price')==R(0))
        await pg.fill('#nome','Chaveiro'); await pg.fill('#peso','76'); await pg.fill('#qtd','15'); await pg.fill('#horas','6'); await pg.fill('#minutos','25')
        await pg.click('#extras'); await pg.keyboard.type('30'); await pg.click('#presets button[data-v="200"]')
        check('preço 3,50', await pg.text_content('#price')==R(3.5))
        await pg.fill('#peso','12.5'); check('peso decimal', 'Filamento R$\xa00,08' in await pg.text_content('#legend'), await pg.text_content('#legend')); await pg.fill('#peso','76')
        # --- lápis
        await pg.click('#editarPreco'); await money('#precoManual','400'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
        check('lápis 4,00', await pg.text_content('#price')==R(4) and await pg.is_visible('#sugerido'))
        await pg.click('#editarPreco'); await money('#precoManual','80'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
        check('alerta abaixo do custo', 'perdem' in await pg.text_content('#alertaTag') and await pg.is_visible('#alertaTag'))
        await pg.click('#editarPreco'); await money('#precoManual','105'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
        check('alerta só custo (1,05)', 'só pagam o custo' in await pg.text_content('#alertaTag'), await pg.text_content('#alertaTag'))
        await pg.click('#voltarSugerido'); check('volta sugerido', await pg.text_content('#price')==R(3.5) and await pg.is_hidden('#alertaTag'))
        await pg.click('#save'); await pg.wait_for_timeout(200); await pg.click('#save'); await pg.wait_for_timeout(200)
        # --- catálogo e vendas
        await pg.click('#tabs a[data-v="pecas"]'); await pg.wait_for_timeout(200)
        check('não duplica', (await pg.text_content('#listaPecas')).count('Chaveiro')==1)
        await pg.click('#listaPecas button[data-a="varias"]'); await pg.tap('#vendaQtd'); await pg.keyboard.type('10'); await pg.wait_for_timeout(80)
        check('venda 10 = 35', await pg.text_content('#vendaTotal')==R(35) and 'ganham' in await pg.text_content('#vendaAviso'))
        await money('#vendaPreco','50'); check('venda prejuízo', 'PERDEM' in await pg.text_content('#vendaAviso'))
        await money('#vendaPreco','350'); await pg.click('#formVenda button[type=submit]'); await pg.wait_for_timeout(300)
        check('total recebido 35', R(35) in await pg.text_content('#totPecas'))
        await pg.click('#listaPecas button[data-a="vendi"]'); await pg.wait_for_timeout(200)
        await pg.click('#listaPecas button[data-a="desfazer"]'); await pg.wait_for_timeout(200)
        check('desfazer 1', R(35) in await pg.text_content('#totPecas'))
        # --- pedido: telefone, preço combinado, desconto
        await pg.click('#listaPecas button[data-a="orcar"]'); await pg.wait_for_timeout(200)
        await pg.fill('#cliente','João'); await pg.click('#formPedido button[type=submit]')
        check('telefone obrigatório', 'WhatsApp' in await pg.text_content('#formErro'))
        await pg.tap('#fone'); await pg.keyboard.type('19998765432'); check('fone formatado', await pg.input_value('#fone')=='(19) 99876-5432')
        await money('#itensForm .preco','800'); check('boa negociação', 'Boa negociação' in await pg.text_content('#formLucro'))
        await money('#desconto','100'); check('desconto aviso ok', await pg.eval_on_selector('#formLucro','e=>e.className')=='aviso ok' and await pg.text_content('#formTotal')==R(7))
        await money('#itensForm .preco','50'); await money('#desconto','0')
        check('item abaixo do custo', await pg.eval_on_selector('#formLucro','e=>e.className')=='aviso neg')
        await money('#itensForm .preco','800')
        await pg.click('#formPedido button[type=submit]'); await pg.wait_for_timeout(200); await pg.click('#dlgSim'); await pg.wait_for_timeout(150); await pg.click('#dlgSim'); await pg.wait_for_timeout(200)
        o=await pg.evaluate('window.__o'); msg=urllib.parse.unquote(o[-1].split('text=')[1])
        check('abre conversa do cliente', o[-1].startswith('https://wa.me/5519998765432?'), o[-1][:40])
        check('mensagem 8,00', '1x Chaveiro — R$\xa08,00' in msg, msg[:150])
        await pg.wait_for_timeout(2600)
        await pg.click('#listaPedidos button[data-a="sinal"]'); await pg.click('#dlgSim'); await pg.wait_for_timeout(200)
        await pg.click('#listaPedidos button[data-a="entregue"]'); await pg.click('#dlgSim'); await pg.wait_for_timeout(2600)
        check('entregue com lucro', 'Entregue' in await pg.text_content('#listaPedidos'))
        # --- foto
        await pg.click('#tabs a[data-v="pecas"]'); await pg.wait_for_timeout(200)
        async with pg.expect_file_chooser() as fc: await pg.click('#listaPecas .foto')
        await (await fc.value).set_files(FOTO); await pg.wait_for_timeout(1500)
        check('foto aparece', await pg.eval_on_selector_all('#listaPecas .foto img','i=>i.length')==1)
        # --- PIN
        await pg.click('#tabs a[data-v="ajustes"]'); await pg.fill('#pin','1234'); await pg.fill('#pin2','1234'); await pg.click('#pinOk'); await pg.wait_for_timeout(300)
        check('PIN abre ajustes', await pg.is_visible('#ajustesConteudo'))
        await pg.reload(); await pg.wait_for_timeout(600)
        check('dados persistem', await pg.eval_on_selector_all('#listaPedidos > li','l=>l.length')==1)
        check('sem rolagem lateral', await pg.evaluate('document.documentElement.scrollWidth')==390)
        check('sem erros', not errs, errs)
        await b.close()
asyncio.run(m())
print(f'PASSOU {len(ok)}/{len(ok)+len(falhas)}'); [print(' FALHOU:',f) for f in falhas]
