-- Fixture for duplicate-row detection and side-by-side table comparison.
-- `customers` contains exact duplicate rows; `customers_v2` is a modified copy
-- used by the compare page (one row changed, one row missing, one row extra).

DROP TABLE IF EXISTS `customers`;
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) DEFAULT NULL,
  `email` varchar(160) DEFAULT NULL,
  `country` char(2) DEFAULT NULL,
  `balance` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `customers` (`id`, `full_name`, `email`, `country`, `balance`) VALUES
(1, 'سالم العتيبي', 'salem@example.com', 'SA', 1500.50),
(2, 'Nora Ahmed', 'nora@example.com', 'AE', 320.00),
(3, 'خالد الشمري', 'khaled@example.com', 'KW', 0.00),
(4, 'Layla Hassan', 'layla@example.com', 'QA', 87.25),
(5, 'سالم العتيبي', 'salem@example.com', 'SA', 1500.50),
(6, 'Nora Ahmed', 'nora@example.com', 'AE', 320.00);

DROP TABLE IF EXISTS `customers_v2`;
CREATE TABLE `customers_v2` (
  `id` int NOT NULL,
  `full_name` varchar(120) DEFAULT NULL,
  `email` varchar(160) DEFAULT NULL,
  `country` char(2) DEFAULT NULL,
  `balance` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `customers_v2` (`id`, `full_name`, `email`, `country`, `balance`) VALUES
(1, 'سالم العتيبي', 'salem@example.com', 'SA', 1500.50),
(2, 'Nora Ahmed', 'nora@example.com', 'AE', 999.00),
(3, 'خالد الشمري', 'khaled@example.com', 'KW', 0.00),
(6, 'Nora Ahmed', 'nora@example.com', 'AE', 320.00),
(7, 'عميل جديد', 'new@example.com', 'SA', 42.00);

-- Dump completed
