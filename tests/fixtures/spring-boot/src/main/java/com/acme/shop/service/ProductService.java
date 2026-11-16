package com.acme.shop.service;

import com.acme.shop.model.Product;
import com.acme.shop.repository.ProductRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProductService {
    private final ProductRepository productRepository;
    private final OrderService orderService;

    public ProductService(ProductRepository productRepository, OrderService orderService) {
        this.productRepository = productRepository;
        this.orderService = orderService;
    }

    public List<Product> listProducts() {
        return productRepository.findAll();
    }

    public Product getBySku(String sku) {
        return productRepository.findBySku(sku).orElseThrow();
    }

    public Product reserve(String sku, int quantity) {
        Product product = getBySku(sku);
        if (product.getStock() < quantity) {
            throw new IllegalStateException("insufficient stock");
        }
        product.setStock(product.getStock() - quantity);
        return productRepository.save(product);
    }

    public long pendingOrders() {
        return orderService.countPending();
    }

    public String describe(List<Product> products) {
        StringBuilder builder = new StringBuilder();
        int index = 0;
        for (Product product : products) {
            if (index > 0) {
                builder.append(", ");
            }
            builder.append(product.getSku());
            builder.append(" x");
            builder.append(product.getStock());
            index++;
        }
        builder.append(" (");
        builder.append(index);
        builder.append(" total)");
        return builder.toString();
    }
}
