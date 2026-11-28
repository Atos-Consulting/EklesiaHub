import { useState } from "react";
import { guardarDadosNaPessoa, mensagemErro } from "./db";
import { difereDaPessoa } from "./financeiro";

// "Guardar no cadastro" (v29): quando os dados de PIX/conta digitados num lançamento não são os do cadastro
// da pessoa, devolve { nome, salvando, erro, onGuardar } para o CamposPagamento; senão, null.
export function useGuardarPessoa(pessoa, dados, onMudou) {
  const [estado, setEstado] = useState({ salvando: false, erro: "", salva: null });
  const atual = estado.salva ?? pessoa;
  if (!atual || !difereDaPessoa(dados, atual)) return null;
  return {
    nome: atual.nome, salvando: estado.salvando, erro: estado.erro,
    onGuardar: async () => {
      setEstado((e) => ({ ...e, salvando: true, erro: "" }));
      try {
        const p = await guardarDadosNaPessoa(atual.id, dados);
        setEstado({ salvando: false, erro: "", salva: p });
        await onMudou?.();
      } catch (e) { setEstado((s) => ({ ...s, salvando: false, erro: mensagemErro(e) })); }
    },
  };
}
