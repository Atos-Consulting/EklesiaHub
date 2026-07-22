-- EklesiaHub - Dados iniciais (seed)

-- Responsáveis
INSERT INTO responsaveis (id, nome, tipo, tipo_doc, documento, telefone, email, nascimento, sexo, observacoes, foto_url) VALUES
(1, 'Marina Andrade',  'mãe',  'CPF', '123.456.789-00', '(11) 98888-0001', 'marina@email.com', '1990-05-10', 'Mulher', '', ''),
(2, 'Carlos Ribeiro',  'pai',  'CPF', '987.654.321-00', '(11) 98888-0002', '',                 '1985-11-22', 'Homem', '', ''),
(3, 'Patrícia Costa',  'mãe',  'CPF', '111.222.333-44', '(11) 98888-0003', '',                 '1988-03-17', 'Mulher', '', '');

-- Ajusta a sequência para continuar a partir do próximo ID
SELECT setval('responsaveis_id_seq', (SELECT MAX(id) FROM responsaveis));

-- Crianças
INSERT INTO criancas (id, codigo, nome, nascimento, turma, alergia, foto_url, status, sala_atual) VALUES
(1, 'KID-0001', 'Lucas Andrade',  '2021-03-12', 'Maternal',  'Nenhuma',  '', 'fora', null),
(2, 'KID-0002', 'Sofia Ribeiro',  '2019-07-02', 'Jardim',    'Amendoim', '', 'fora', null),
(3, 'KID-0003', 'Davi Souza',     '2017-11-20', 'Juniores',  'Nenhuma',  '', 'fora', null),
(4, 'KID-0004', 'Helena Costa',   '2022-01-15', 'Berçário',  'Lactose',  '', 'fora', null);

SELECT setval('criancas_id_seq', (SELECT MAX(id) FROM criancas));

-- Vínculos criança ↔ responsável
INSERT INTO crianca_responsavel (crianca_id, responsavel_id) VALUES
(1, 1),  -- Lucas → Marina
(2, 2),  -- Sofia → Carlos
(3, 1),  -- Davi  → Marina
(4, 3);  -- Helena → Patrícia

-- Professores
INSERT INTO professores (id, nome, telefone, email, observacoes, foto_url) VALUES
(1, 'Ana Paula Lima',   '(11) 99999-0001', 'ana@igreja.com',     '', ''),
(2, 'Roberto Ferreira', '(11) 99999-0002', 'roberto@igreja.com', '', '');

SELECT setval('professores_id_seq', (SELECT MAX(id) FROM professores));

-- Salas
INSERT INTO salas (id, identificador, nome, idade_inicial, idade_final, capacidade, observacoes) VALUES
(1, '101', 'Berçário',  0,  1,  8, ''),
(2, '102', 'Maternal',  2,  3, 12, ''),
(3, '103', 'Jardim',    4,  6, 15, ''),
(4, '104', 'Juniores',  7, 10, 20, '');

SELECT setval('salas_id_seq', (SELECT MAX(id) FROM salas));
