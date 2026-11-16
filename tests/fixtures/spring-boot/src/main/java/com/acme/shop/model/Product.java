package com.acme.shop.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "products")
public class Product {
    @Id
    @GeneratedValue
    private Long id;

    @Column(nullable = false, unique = true)
    private String sku;

    private String name;

    private long priceCents;

    private int stock;

    public Long getId() { return id; }
    public String getSku() { return sku; }
    public String getName() { return name; }
    public long getPriceCents() { return priceCents; }
    public int getStock() { return stock; }
    public void setStock(int stock) { this.stock = stock; }
}
