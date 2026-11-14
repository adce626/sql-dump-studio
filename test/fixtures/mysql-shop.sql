-- MySQL 8 dump fixture for SQL Dump Studio
-- Arabic text included to verify RTL + UTF-8 handling.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

--
-- Table structure for table `customers`
--
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) NOT NULL COMMENT 'الاسم الكامل',
  `email` varchar(160) NOT NULL,
  `country` char(2) DEFAULT 'SA',
  `balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_email` (`email`),
  KEY `idx_customers_country` (`country`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='العملاء';

--
-- Table structure for table `orders`
--
CREATE TABLE `orders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `status` enum('pending','paid','shipped','cancelled') NOT NULL DEFAULT 'pending',
  `placed_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_orders_customer` (`customer_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `order_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `product` varchar(80) NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `unit_price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `shipping_addresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `city` varchar(60) NOT NULL,
  `street` varchar(180) NOT NULL,
  `postal_code` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_addresses_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Data
--
INSERT INTO `customers` (`id`, `full_name`, `email`, `country`, `balance`, `is_active`, `notes`, `created_at`) VALUES
(1, 'سالم العتيبي', 'salem@example.com', 'SA', 1500.50, 1, 'عميل مميز', '2024-01-15 09:30:00'),
(2, 'Nora Ahmed', 'nora@example.com', 'AE', 320.00, 1, NULL, '2024-02-02 14:05:12'),
(3, 'خالد الشمري', 'khaled@example.com', 'KW', 0.00, 0, 'موقوف مؤقتًا', '2024-03-21 18:45:59'),
(4, 'Layla Hassan', 'layla@example.com', 'QA', 87.25, 1, 'Special customer', '2024-04-08 11:12:00');

INSERT INTO `orders` (`id`, `customer_id`, `total`, `status`, `placed_at`) VALUES
(1, 1, 250.00, 'paid', '2024-05-01 10:00:00'),
(2, 1, 99.99, 'shipped', '2024-05-04 16:20:00'),
(3, 2, 420.00, 'pending', '2024-05-09 08:15:00'),
(4, 3, 15.75, 'cancelled', '2024-05-11 21:40:33');

INSERT INTO `order_items` (`id`, `order_id`, `product`, `quantity`, `unit_price`) VALUES
(1, 1, 'Wireless Mouse', 2, 75.00),
(2, 1, 'USB-C Cable', 1, 40.00),
(3, 1, 'Keyboard Cover', 3, 20.00),
(4, 2, 'Monitor Stand', 1, 99.99),
(5, 3, 'Desk Lamp', 2, 210.00),
(6, 4, 'Notebook', 5, 3.15);

INSERT INTO `shipping_addresses` (`id`, `customer_id`, `city`, `street`, `postal_code`) VALUES
(1, 1, 'الرياض', 'حي الياسمين، شارع الأمير سلطان', '13321'),
(2, 2, 'Dubai', 'Sheikh Zayed Road, Tower 2', NULL),
(3, 4, 'Doha', 'Al Waab Street, Villa 44', '12345');

-- Dump completed
